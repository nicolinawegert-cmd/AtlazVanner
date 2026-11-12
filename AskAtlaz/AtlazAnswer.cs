namespace AtlazVanner.AskAtlaz;

public enum Visitor
{
    Human,
    Dog
}

// Fallback är sant när svaret är ett färdigt reservsvar och inte kommer från AI:n.
// Mood styr hur Atlaz rör sig, och Suggestions visas som förslag på nästa fråga.
public record AtlazAnswer(string Bark, string Translation, bool Fallback = false)
{
    public string Mood { get; init; } = Moods.Happy;

    public IReadOnlyList<string> Suggestions { get; init; } = [];

    // Det Atlaz har fyllt i medan han hjälper besökaren att boka en aktivitet, annars null
    public BookingDraft? Booking { get; init; }
}

// En aktivitet som Atlaz håller på att boka in. Date skrivs 2026-11-13 och Time 17:00.
// Ready blir sant när allt som behövs finns och Atlaz har frågat om han ska lägga in den.
public record BookingDraft(string? Name, string? Date, string? Time, string? Place, string? Description, bool Ready = false);

// En tidigare replik i samtalet. Role är "visitor" eller "atlaz".
public record ChatTurn(string? Role, string? Text);

// Hur Atlaz kan känna sig. Samma ord används i JavaScript och CSS.
public static class Moods
{
    public const string Happy = "happy";
    public const string Curious = "curious";
    public const string Playful = "playful";
    public const string Tired = "tired";
    public const string Worried = "worried";

    public static readonly string[] All = [Happy, Curious, Playful, Tired, Worried];
}

// Används när AI:n inte kan svara, så att sidan aldrig går sönder
internal static class FallbackAnswers
{
    public static AtlazAnswer Tired(Visitor visitor) => (visitor == Visitor.Dog
        ? new AtlazAnswer(
            "Voff… *gäspar stort* *lägger sig i korgen*",
            "Hej kompis! Jag har sprungit efter så många ekorrar idag att tassarna behöver vila. Nosa på mig igen om en stund, så svarar jag. 🐾",
            Fallback: true)
        : new AtlazAnswer(
            "Voff… *gäspar stort* *lägger sig i korgen*",
            "Förlåt, jag är lite trött just nu och kan inte svara på din fråga. Fråga mig igen om en stund! 🐾",
            Fallback: true)) with { Mood = Moods.Tired };

    public static AtlazAnswer TooManyQuestions(Visitor visitor) => (visitor == Visitor.Dog
        ? new AtlazAnswer(
            "VOFF VOFF VOFF! *flämtar* *rullar runt på rygg*",
            "Oj, så många frågor, kompis! Nu måste jag dricka lite vatten och vila tassarna. Kom tillbaka lite senare. 🐾",
            Fallback: true)
        : new AtlazAnswer(
            "VOFF VOFF VOFF! *flämtar* *rullar runt på rygg*",
            "Oj, så många frågor! Nu måste jag dricka lite vatten och vila tassarna. Fråga mig igen lite senare. 🐾",
            Fallback: true)) with { Mood = Moods.Playful };
}
