document.addEventListener("DOMContentLoaded", () => {
    const lightbox = document.querySelector(".lightbox");

    if (!lightbox) {
        return;
    }

    const lightboxImage = lightbox.querySelector(".lightbox-image");
    const closeButton = lightbox.querySelector(".lightbox-close");
    let openedFrom = null;

    document.querySelectorAll(".gallery-link").forEach(link => {
        link.addEventListener("click", (event) => {
            // Visa bilden i dialogen i stället för att följa länken
            event.preventDefault();

            const thumbnail = link.querySelector("img");

            lightboxImage.src = link.href;
            lightboxImage.alt = thumbnail ? thumbnail.alt : "";
            openedFrom = link;

            lightbox.showModal();
        });
    });

    closeButton.addEventListener("click", () => {
        lightbox.close();
    });

    // Klick på den mörka bakgrunden stänger
    lightbox.addEventListener("click", (event) => {
        if (event.target === lightbox) {
            lightbox.close();
        }
    });

    // Körs både vid Esc, knappen och klick utanför
    lightbox.addEventListener("close", () => {
        lightboxImage.removeAttribute("src");

        if (openedFrom) {
            openedFrom.focus();
        }
    });
});
