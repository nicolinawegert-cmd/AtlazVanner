using System.Collections.Concurrent;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Web;
using Umbraco.Extensions;

namespace AtlazVanner.AskAtlaz;

public record AskAtlazRequest(string? Question, string? Visitor, Guid? PageKey);

public static class AskAtlazEndpoints
{
    private const int MinQuestionLength = 3;
    private const int MaxQuestionLength = 300;

    public static IServiceCollection AddAskAtlaz(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AskAtlazOptions>(configuration.GetSection(AskAtlazOptions.Section));
        services.AddHttpClient<AskAtlazService>(client => client.Timeout = TimeSpan.FromSeconds(25));
        services.AddSingleton<QuestionLimiter>();

        return services;
    }

    public static IEndpointRouteBuilder MapAskAtlaz(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/api/fraga-atlaz", AskAsync);

        return endpoints;
    }

    private static async Task<IResult> AskAsync(
        AskAtlazRequest request,
        HttpContext httpContext,
        AskAtlazService service,
        QuestionLimiter limiter,
        IUmbracoContextFactory umbracoContextFactory,
        CancellationToken cancellationToken)
    {
        var question = request.Question?.Trim() ?? "";

        if (question.Length is < MinQuestionLength or > MaxQuestionLength)
        {
            return Results.BadRequest($"Frågan ska vara mellan {MinQuestionLength} och {MaxQuestionLength} tecken.");
        }

        var visitor = request.Visitor == "dog" ? Visitor.Dog : Visitor.Human;
        var visitorId = httpContext.Connection.RemoteIpAddress?.ToString() ?? "okänd";

        if (!limiter.TryTake(visitorId))
        {
            return Results.Ok(FallbackAnswers.TooManyQuestions(visitor));
        }

        var facts = ReadFacts(umbracoContextFactory, request.PageKey);
        var answer = await service.AskAsync(question, visitor, facts, cancellationToken);

        return Results.Ok(answer);
    }

    // Fakta om Atlaz hämtas från sidan i Umbraco, aldrig från webbläsaren.
    // Föreningens träffar från kontaktsidan läggs till, så att Atlaz kan föreslå dem.
    private static string? ReadFacts(IUmbracoContextFactory umbracoContextFactory, Guid? pageKey)
    {
        if (pageKey is null)
        {
            return null;
        }

        using var contextReference = umbracoContextFactory.EnsureUmbracoContext();
        var page = contextReference.UmbracoContext.Content?.GetById(pageKey.Value);

        if (page?.ContentType.Alias != "askAtlazPage")
        {
            return null;
        }

        var facts = page.Value<string>("atlazFacts");
        var meetups = page.Root().Children()
            .FirstOrDefault(child => child.ContentType.Alias == "contactPage")
            ?.Value<string>("meetups");

        return string.IsNullOrWhiteSpace(meetups)
            ? facts
            : $"{facts}\n\nFöreningens träffar, från kontaktsidan:\n{meetups.Trim()}";
    }
}

// Räknar frågor per besökare den senaste timmen
public class QuestionLimiter(IOptionsMonitor<AskAtlazOptions> options)
{
    private readonly ConcurrentDictionary<string, Queue<DateTime>> _questions = new();

    public bool TryTake(string visitorId)
    {
        var now = DateTime.UtcNow;
        var times = _questions.GetOrAdd(visitorId, _ => new Queue<DateTime>());

        lock (times)
        {
            while (times.Count > 0 && now - times.Peek() > TimeSpan.FromHours(1))
            {
                times.Dequeue();
            }

            if (times.Count >= options.CurrentValue.QuestionsPerHour)
            {
                return false;
            }

            times.Enqueue(now);
            return true;
        }
    }
}
