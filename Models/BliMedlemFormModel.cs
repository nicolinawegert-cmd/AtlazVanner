using System.ComponentModel.DataAnnotations;

namespace AtlazVanner.Models;

public class BliMedlemFormModel
{
    [Required(ErrorMessage = "Fyll i ditt förnamn")]
    [Display(Name = "Förnamn")]
    public string FirstName { get; set; } = "";

    [Required(ErrorMessage = "Fyll i ditt efternamn")]
    [Display(Name = "Efternamn")]
    public string LastName { get; set; } = "";

    [Required(ErrorMessage = "Fyll i din e-postadress")]
    [EmailAddress(ErrorMessage = "Skriv en giltig e-postadress")]
    [Display(Name = "E-postadress")]
    public string Email { get; set; } = "";

    [Required(ErrorMessage = "Välj medlemskapstyp")]
    [Display(Name = "Medlemskapstyp")]
    public string? MembershipType { get; set; }

    [Phone(ErrorMessage = "Skriv ett giltigt telefonnummer")]
    [Display(Name = "Telefonnummer (frivilligt)")]
    public string? Phone { get; set; }
}
