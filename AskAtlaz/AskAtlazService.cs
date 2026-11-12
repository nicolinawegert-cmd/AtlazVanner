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

    // Har en modell inte svarat inom så här lång tid frågas nästa modell samtidigt,
    // och det svar som kommer först används. Gratismodellerna svarar ibland på en sekund
    // och ibland på sju, så då slipper besökaren vänta ut en långsam modell.
    private static readonly TimeSpan HedgeDelay = TimeSpan.FromSeconds(3);
    private const int MaxParallelModels = 2;

    // Hur många varv alla modeller provas innan Atlaz blir trött
    private const int Rounds = 3;

    public async Task<AtlazAnswer> AskAsync(
        string question,
        Visitor visitor,
        string? facts,
        IReadOnlyList<ChatTurn>? history,
        BookingDraft? booking,
        CancellationToken cancellationToken)
    {
        var settings = options.CurrentValue;

        if (string.IsNullOrWhiteSpace(settings.GeminiApiKey))
        {
            logger.LogWarning("Fråga Atlaz: ingen Gemini-nyckel är inställd, så ett reservsvar används");
            return FallbackAnswers.Tired(visitor);
        }

        var today = DateOnly.FromDateTime(DateTime.Now);

        var payload = new
        {
            systemInstruction = new { parts = new[] { new { text = AtlazPersona.SystemPrompt(facts, today) } } },
            contents = AtlazPersona.Conversation(question, visitor, history, booking)
                .Select(turn => new { role = turn.Role, parts = new[] { new { text = turn.Text } } })
                .ToArray(),
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
                        suggestions = new { type = "ARRAY", items = new { type = "STRING" } },
                        booking = new
                        {
                            type = "OBJECT",
                            nullable = true,
                            properties = new
                            {
                                name = new { type = "STRING" },
                                date = new { type = "STRING" },
                                time = new { type = "STRING" },
                                place = new { type = "STRING" },
                                description = new { type = "STRING" },
                                ready = new { type = "BOOLEAN" }
                            },
                            required = new[] { "ready" }
                        }
                    },
                    required = new[] { "bark", "translation", "mood", "suggestions", "booking" }
                },
                maxOutputTokens = 2048
            }
        };

        // Gratismodellerna är ibland överbelastade (503), har slut på kvot för stunden (429),
        // svarar långsamt eller inte alls. Då provas reservmodellerna, och sedan alla ett par varv till,
        // innan Atlaz blir trött.
        var models = new[] { settings.Model }
            .Concat(settings.FallbackModels)
            .Where(model => !string.IsNullOrWhiteSpace(model))
            .Select(model => model!)
            .Distinct()
            .ToList();

        var queue = new Queue<string>(Enumerable.Repeat(models, Rounds).SelectMany(round => round));
        var running = new List<Task<AtlazAnswer?>>();

        // Besökaren ska inte behöva vänta hur länge som helst på svaret
        using var total = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        total.CancelAfter(TotalTimeout);

        void StartNextModel()
        {
            if (queue.Count > 0 && running.Count < MaxParallelModels)
            {
                running.Add(TryModelAsync(queue.Dequeue(), payload, settings.GeminiApiKey, today, total.Token));
            }
        }

        StartNextModel();

        while (running.Count > 0)
        {
            var hedge = Task.Delay(HedgeDelay, total.Token);
            var finished = await Task.WhenAny(running.Append<Task>(hedge));

            if (finished == hedge)
            {
                // Tiden är slut, eller så har besökaren gått från sidan
                if (hedge.IsCanceled)
                {
                    break;
                }

                StartNextModel();
                continue;
            }

            var attempt = (Task<AtlazAnswer?>)finished;
            running.Remove(attempt);

            var answer = await attempt;

            if (answer is not null)
            {
                // Den andra modellen behövs inte längre
                await total.CancelAsync();
                return answer;
            }

            StartNextModel();
        }

        cancellationToken.ThrowIfCancellationRequested();

        logger.LogWarning(
            "Fråga Atlaz: ingen modell svarade inom {Seconds} sekunder, så ett reservsvar används",
            TotalTimeout.TotalSeconds);
        return FallbackAnswers.Tired(visitor);
    }

    // Frågar en modell. Svarar null om modellen är upptagen, för långsam eller svarar något som inte går att läsa.
    private async Task<AtlazAnswer?> TryModelAsync(
        string model,
        object payload,
        string apiKey,
        DateOnly today,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent");

        request.Headers.Add("x-goog-api-key", apiKey);
        request.Content = JsonContent.Create(payload);

        // Varje modell får en egen tidsgräns, så att det finns tid kvar att prova nästa
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(ModelTimeout);

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
                return null;
            }

            if (!response.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Fråga Atlaz: {Model} svarade {StatusCode}: {Body}",
                    model,
                    (int)response.StatusCode,
                    body.Length > 500 ? body[..500] : body);
                return null;
            }

            var answer = ParseAnswer(body, today);

            if (answer is null)
            {
                logger.LogWarning("Fråga Atlaz: kunde inte läsa svaret från {Model}: {Body}", model, body.Length > 500 ? body[..500] : body);
            }

            return answer;
        }
        catch (OperationCanceledException)
        {
            // Annars har en annan modell redan svarat, eller så är den totala tiden slut
            if (!cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(
                    "Fråga Atlaz: {Model} svarade inte inom {Seconds} sekunder, provar nästa modell",
                    model,
                    ModelTimeout.TotalSeconds);
            }

            return null;
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or InvalidOperationException)
        {
            logger.LogWarning(exception, "Fråga Atlaz: anropet till {Model} misslyckades", model);
            return null;
        }
    }

    private static AtlazAnswer? ParseAnswer(string body, DateOnly today)
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

        var booking = ReadBooking(json?["booking"], today);

        return new AtlazAnswer(Shorten(bark, MaxBarkLength), Shorten(translation, MaxTranslationLength))
        {
            Mood = Moods.All.Contains(mood) ? mood! : Moods.Happy,
            // Medan Atlaz frågar om han ska lägga in bokningen är det ja- och nej-knapparna som gäller
            Suggestions = booking?.Ready == true ? [] : ReadSuggestions(json?["suggestions"]),
            Booking = booking
        };
    }

    // Det AI:n har fyllt i om bokningen. Fält som inte går att läsa blir tomma, och bokningen
    // är bara klar om allt som behövs finns, även om AI:n har sagt att den är klar.
    private static BookingDraft? ReadBooking(JsonNode? node, DateOnly today)
    {
        if (node is not JsonObject booking)
        {
            return null;
        }

        var date = ActivityBooking.TryReadDate(ReadText(booking["date"]), out var day) && day >= today
            ? day.ToString("yyyy-MM-dd")
            : null;
        var time = ActivityBooking.TryReadTime(ReadText(booking["time"]), out var clock)
            ? clock.ToString("HH:mm")
            : null;

        var draft = new BookingDraft(
            NullIfEmpty(ReadText(booking["name"]), ActivityBooking.MaxNameLength),
            date,
            time,
            NullIfEmpty(ReadText(booking["place"]), ActivityBooking.MaxPlaceLength),
            NullIfEmpty(ReadText(booking["description"]), ActivityBooking.MaxDescriptionLength));

        if (draft is { Name: null, Date: null, Time: null, Place: null, Description: null })
        {
            return null;
        }

        var isComplete = draft is { Name: not null, Date: not null, Time: not null, Place: not null };

        return draft with { Ready = isComplete && booking["ready"]?.GetValueKind() == JsonValueKind.True };
    }

    // Klipps utan "…", så att texten alltid ryms när bokningen sparas
    private static string? NullIfEmpty(string? text, int maxLength) =>
        string.IsNullOrWhiteSpace(text) ? null : text.Trim()[..Math.Min(text.Trim().Length, maxLength)].TrimEnd();

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
