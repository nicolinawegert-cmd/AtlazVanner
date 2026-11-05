using AtlazVanner.Models;
using Microsoft.AspNetCore.Mvc;
using Umbraco.Cms.Core.Cache;
using Umbraco.Cms.Core.Logging;
using Umbraco.Cms.Core.Routing;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Web;
using Umbraco.Cms.Infrastructure.Persistence;
using Umbraco.Cms.Web.Website.Controllers;

namespace AtlazVanner.Controllers;

public class BliMedlemController : SurfaceController
{
    public BliMedlemController(
        IUmbracoContextAccessor umbracoContextAccessor,
        IUmbracoDatabaseFactory databaseFactory,
        ServiceContext services,
        AppCaches appCaches,
        IProfilingLogger profilingLogger,
        IPublishedUrlProvider publishedUrlProvider)
        : base(umbracoContextAccessor, databaseFactory, services, appCaches, profilingLogger, publishedUrlProvider)
    {
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Submit(BliMedlemFormModel model)
    {
        if (!ModelState.IsValid)
        {
            // Visa formuläret igen, med felmeddelanden och det som skrevs in
            return CurrentUmbracoPage();
        }

        // Här skulle uppgifterna skickas som mejl eller sparas.
        // I skolprojektet visar vi bara ett tack.
        TempData["BliMedlemOk"] = true;

        return RedirectToCurrentUmbracoPage();
    }
}
