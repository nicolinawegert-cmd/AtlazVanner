namespace AtlazVanner.AskAtlaz;

public class AskAtlazOptions
{
    public const string Section = "FragaAtlaz";

    // Nyckeln från Google AI Studio. Den ligger bara i appsettings.Local.json och aldrig i Git
    public string? GeminiApiKey { get; set; }

    // Lite-modellerna svarar snabbast och har oftast plats på gratisnivån
    public string Model { get; set; } = "gemini-3.5-flash-lite";

    // Provas i tur och ordning när Model är överbelastad, har slut på gratiskvot eller inte svarar.
    // Listan står i appsettings.json. Den är tom här, annars lägger .NET ihop båda listorna.
    public string[] FallbackModels { get; set; } = [];

    // Skyddar gratiskvoten hos Google mot att en enda besökare använder upp den
    public int QuestionsPerHour { get; set; } = 20;
}
