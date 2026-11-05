using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace AtlazVanner.AskAtlaz;

// Skickar frågan till Google Gemini och gör om svaret till ett AtlazAnswer.
// Allt som kan gå fel ger ett reservsvar i stället för ett fel på sidan.
public class AskAtlazService(
    HttpClient http,
    IOptionsMonitor<AskAtlazOptions> options,
    ILogger<AskAtlazService> logger)
{
    private const int MaxBarkLength = 300;
    private const int MaxTranslationLength = 1200;
    private const int MaxSuggestions = 3;
    private const int MinSuggestionLength = 3;
    private const int MaxSuggestionLength = 80;
    private static readonly TimeSpan ModelTimeout = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan TotalTimeout = TimeSpan.FromSeconds(20);

    // Pauserna mellan varven. Gratismodellerna brukar bli lediga igen efter några sekunder.
    private static readonly TimeSpan[] PausesBetweenRounds = [TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(2)];

    public async Task<AtlazAnswer> AskAsync(string question, Visitor visitor, string? facts, CancellationToken cancellationToken)
    {
        var settings = options.CurrentValue;

        if (string.IsNullOrWhiteSpace(settings.GeminiApiKey))
        {
            logger.LogWarning("Fråga Atlaz: ingen Gemini-nyckel är inställd, så ett reservsvar används");
            return FallbackAnswers.Tired(visitor);
        }

        var payload = new
        {
            systemInstruction = new { parts = new[] { new { text = AtlazPersona.SystemPrompt(facts, DateOnly.FromDateTime(DateTime.Now)) } } },
            contents = new[]
            {
                new { role = "user", parts = new[] { new { text = AtlazPersona.UserMessage(question, visitor) } } }
            },
            generationConfig = new
            {
                responseMimeType = "application/json",
                responseSchema = new
                {
                    type = "OBJECT",
                    properties = new
                    {
                        bark = new { type = "STRING" },
                        translation = new { type = "STRING" },
                        mood = new { type = "STRING", format = "enum", @enum = Moods.All },
                        suggestions = new { type = "ARRAY", items = new { type = "STRING" } }
                    },
                    required = new[] { "bark", "translation", "mood", "suggestions" }
                },
                maxOutputTokens = 2048
            }
        };

        // Gratismodellerna är ibland överbelastade (503), har slut på kvot för stunden (429)
        // eller svarar inte alls. Då provas reservmodellerna, och sedan alla ett par varv till,
        // innan Atlaz blir trött.
        var models = new[] { settings.Model }
            .Concat(settings.FallbackModels)
            .Where(model => !string.IsNullOrWhiteSpace(model))
            .Distinct()
            .ToList();

        var stopwatch = Stopwatch.StartNew();

        for (var round = 0; round <= PausesBetweenRounds.Length; round++)
        {
            if (round > 0)
            {
                await Task.Delay(PausesBetweenRounds[round - 1], cancellationToken);
            }

            foreach (var model in models)
            {
                var timeLeft = TotalTimeout - stopwatch.Elapsed;

                // Besökaren ska inte behöva vänta hur länge som helst på svaret
                if (timeLeft <= TimeSpan.Zero)
                {
                    logger.LogWarning(
                        "Fråga Atlaz: ingen modell svarade inom {Seconds} sekunder, så ett reservsvar används",
                        TotalTimeout.TotalSeconds);
                    return FallbackAnswers.Tired(visitor);
                }

                using var request = new HttpRequestMessage(
                    HttpMethod.Post,
                    $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model!)}:generateContent");

                request.Headers.Add("x-goog-api-key", settings.GeminiApiKey);
                request.Content = JsonContent.Create(payload);

                // Varje modell får en egen tidsgräns, så att det finns tid kvar att prova nästa
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(timeLeft < ModelTimeout ? timeLeft : ModelTimeout);

                try
                {
                    using var response = await http.SendAsync(request, timeout.Token);
                    var body = await response.Content.ReadAsStringAsync(timeout.Token);

                    if (response.StatusCode is HttpStatusCode.ServiceUnavailable or HttpStatusCode.TooManyRequests)
                    {
                        logger.LogWarning(
                            "Fråga Atlaz: {Model} svarade {StatusCode}, provar nästa modell",
                            model,
                            (int)response.StatusCode);
                        continue;
                    }

                    if (!response.IsSuccessStatusCode)
                    {
                        logger.LogWarning(
                            "Fråga Atlaz: {Model} svarade {StatusCode}: {Body}",
                            model,
                            (int)response.StatusCode,
                            body.Length > 500 ? body[..500] : body);
                        return FallbackAnswers.Tired(visitor);
                    }

                    var answer = ParseAnswer(body);

                    if (answer is null)
                    {
                        logger.LogWarning("Fråga Atlaz: kunde inte läsa svaret från {Model}: {Body}", model, body.Length > 500 ? body[..500] : body);
                        return FallbackAnswers.Tired(visitor);
                    }

                    return answer;
                }
                catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                {
                    logger.LogWarning(
                        "Fråga Atlaz: {Model} svarade inte inom {Seconds} sekunder, provar nästa modell",
                        model,
                        ModelTimeout.TotalSeconds);
                }
                catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException)
                {
                    logger.LogWarning(exception, "Fråga Atlaz: anropet till {Model} misslyckades", model);
                    return FallbackAnswers.Tired(visitor);
                }
            }
        }

        logger.LogWarning("Fråga Atlaz: alla modeller var upptagna, så ett reservsvar används");
        return FallbackAnswers.Tired(visitor);
    }

    private static AtlazAnswer? ParseAnswer(string body)
    {
        var parts = JsonNode.Parse(body)?["candidates"]?[0]?["content"]?["parts"]?.AsArray();

        if (parts is null)
        {
            return null;
        }

        // Delar där modellen tänker högt hoppas över, bara själva svaret används
        var text = string.Concat(parts
            .Where(part => part?["thought"]?.GetValue<bool>() != true)
            .Select(part => part?["text"]?.GetValue<string>()));

        // Ibland kommer JSON:en inslagen i ```json ... ```
        var cleaned = text.Trim();

        if (cleaned.StartsWith("```", StringComparison.Ordinal))
        {
            cleaned = cleaned[(cleaned.IndexOf('\n') + 1)..].TrimEnd('`').Trim();
        }

        var json = JsonNode.Parse(cleaned);
        var bark = json?["bark"]?.GetValue<string>()?.Trim();
        var translation = json?["translation"]?.GetValue<string>()?.Trim();

        if (string.IsNullOrEmpty(bark) || string.IsNullOrEmpty(translation))
        {
            return null;
        }

        var mood = ReadText(json?["mood"])?.ToLowerInvariant();

        return new AtlazAnswer(Shorten(bark, MaxBarkLength), Shorten(translation, MaxTranslationLength))
        {
            Mood = Moods.All.Contains(mood) ? mood! : Moods.Happy,
            Suggestions = ReadSuggestions(json?["suggestions"])
        };
    }

    // Förslagen blir knappar som skickas som nya frågor, så de ska vara få och korta
    private static IReadOnlyList<string> ReadSuggestions(JsonNode? node) =>
        node is JsonArray suggestions
            ? suggestions
                .Select(ReadText)
                .OfType<string>()
                .Where(text => text.Length is >= MinSuggestionLength and <= MaxSuggestionLength)
                .Distinct()
                .Take(MaxSuggestions)
                .ToList()
            : [];

    private static string? ReadText(JsonNode? node) =>
        node?.GetValueKind() == JsonValueKind.String ? node.GetValue<string>().Trim() : null;

    private static string Shorten(string text, int maxLength) =>
        text.Length <= maxLength ? text : text[..maxLength].TrimEnd() + "…";
}
