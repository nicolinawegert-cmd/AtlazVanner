using System.Globalization;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Web;
using Umbraco.Extensions;

namespace AtlazVanner.AskAtlaz;

public record BookActivityRequest(string? Name, string? Date, string? Time, string? Place, string? Description, Guid? PageKey);

// En aktivitet som har bokats via Atlaz men som ingen har publicerat än
public record PendingActivity(string Name, DateTime Date, string? LocationAndTime);

// Atlaz bokar in aktiviteter som utkast under sidan Aktiviteter. Sidan är öppen för alla,
// så en admin publicerar dem i Umbraco innan de räknas som riktiga aktiviteter.
// Tills dess visas de som väntande på aktivitetssidan.
public static class ActivityBooking
{
    public const int MinNameLength = 3;
    public const int MaxNameLength = 60;
    public const int MinPlaceLength = 2;
    public const int MaxPlaceLength = 80;
    public const int MaxDescriptionLength = 500;

    private const string ActivityPageAlias = "activityPage";
    private const string ActivityItemAlias = "activityItem";
    private const int MaxDaysAhead = 365;

    private static readonly string[] TimeFormats = ["HH:mm", "H:mm", "HH.mm", "H.mm"];

    public static bool TryReadDate(string? text, out DateOnly date) =>
        DateOnly.TryParseExact(text?.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    public static bool TryReadTime(string? text, out TimeOnly time) =>
        TimeOnly.TryParseExact(text?.Trim(), TimeFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out time);

    public static IResult Book(
        BookActivityRequest request,
        HttpContext httpContext,
        BookingLimiter limiter,
        IUmbracoContextFactory umbracoContextFactory,
        IContentService contentService,
        ILoggerFactory loggerFactory)
    {
        var name = request.Name?.Trim() ?? "";
        var place = request.Place?.Trim() ?? "";
        var description = request.Description?.Trim() ?? "";

        if (name.Length is < MinNameLength or > MaxNameLength)
        {
            return Problem($"Namnet ska vara mellan {MinNameLength} och {MaxNameLength} tecken.");
        }

        if (place.Length is < MinPlaceLength or > MaxPlaceLength)
        {
            return Problem($"Platsen ska vara mellan {MinPlaceLength} och {MaxPlaceLength} tecken.");
        }

        if (description.Length > MaxDescriptionLength)
        {
            return Problem($"Informationen får vara högst {MaxDescriptionLength} tecken.");
        }

        if (!TryReadDate(request.Date, out var date) || !TryReadTime(request.Time, out var time))
        {
            return Problem("Datumet eller tiden går inte att läsa.");
        }

        var startsAt = date.ToDateTime(time);

        if (startsAt <= DateTime.Now)
        {
            return Problem("Den tiden har redan varit.");
        }

        if (startsAt > DateTime.Now.AddDays(MaxDaysAhead))
        {
            return Problem("Aktiviteten kan bokas högst ett år fram i tiden.");
        }

        var visitorId = httpContext.Connection.RemoteIpAddress?.ToString() ?? "okänd";

        if (!limiter.TryTake(visitorId))
        {
            return Problem("Du har bokat många aktiviteter på kort tid. Vänta en stund och försök igen.", StatusCodes.Status429TooManyRequests);
        }

        var activityPage = FindActivityPage(umbracoContextFactory, request.PageKey);

        if (activityPage is null)
        {
            return Problem("Hittar ingen aktivitetssida att lägga in aktiviteten på.", StatusCodes.Status404NotFound);
        }

        var content = contentService.Create(name, activityPage.Value.Key, ActivityItemAlias);
        content.SetValue("activityDate", startsAt);
        content.SetValue("locationAndTime", $"{place} · Start {time:HH.mm}");
        content.SetValue("description", description);

        // Sparas men publiceras inte, så att en admin hinner titta på den först
        var result = contentService.Save(content);

        if (!result.Success)
        {
            loggerFactory.CreateLogger(nameof(ActivityBooking))
                .LogWarning("Fråga Atlaz: kunde inte spara bokningen {Name}: {Result}", name, result.Result);
            return Problem("Aktiviteten gick inte att spara.", StatusCodes.Status500InternalServerError);
        }

        return Results.Ok(new
        {
            name,
            date = date.ToString("yyyy-MM-dd"),
            time = time.ToString("HH:mm"),
            place,
            activitiesUrl = activityPage.Value.Url
        });
    }

    // Aktiviteter under sidan som inte är publicerade och inte redan har varit
    public static IReadOnlyList<PendingActivity> Pending(IContentService contentService, int activityPageId)
    {
        return contentService
            .GetPagedChildren(activityPageId, 0, 200, out _, ["activityDate", "locationAndTime"], filter: null, ordering: null, loadTemplates: false)
            .Where(content => !content.Published && !content.Trashed && content.ContentType.Alias == ActivityItemAlias)
            .Select(content => new PendingActivity(
                content.Name ?? "",
                content.GetValue<DateTime?>("activityDate") ?? default,
                content.GetValue<string>("locationAndTime")))
            .Where(activity => activity.Date >= DateTime.Today)
            .OrderBy(activity => activity.Date)
            .ToList();
    }

    // Aktivitetssidan letas upp från sidan med Atlaz, så att besökaren inte kan välja var den hamnar
    private static (Guid Key, string Url)? FindActivityPage(IUmbracoContextFactory umbracoContextFactory, Guid? pageKey)
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

        var activityPage = page.Root().Children().FirstOrDefault(child => child.ContentType.Alias == ActivityPageAlias);

        return activityPage is null ? null : (activityPage.Key, activityPage.Url());
    }

    private static IResult Problem(string message, int statusCode = StatusCodes.Status400BadRequest) =>
        Results.Json(new { message }, statusCode: statusCode);
}
