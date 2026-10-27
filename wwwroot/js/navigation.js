
document.documentElement.classList.add("js-enabled");

document.addEventListener("DOMContentLoaded", () => {
    const menuButton = document.querySelector(".nav-toggle");
    const navigation = document.querySelector(".site-nav");
    const menuIcon = document.querySelector(".nav-toggle-icon");

    if (!menuButton || !navigation || !menuIcon) {
        return;
    }

    function closeMenu() {
        navigation.classList.remove("is-open");
        menuButton.setAttribute("aria-expanded", "false");
        menuButton.setAttribute("aria-label", "Öppna meny");
        menuIcon.textContent = "☰";
    }

    menuButton.addEventListener("click", () => {
        const isOpen = navigation.classList.toggle("is-open");

        menuButton.setAttribute(
            "aria-expanded",
            String(isOpen)
        );

        menuButton.setAttribute(
            "aria-label",
            isOpen ? "Stäng meny" : "Öppna meny"
        );

        menuIcon.textContent = isOpen ? "✕" : "☰";
    });

    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            navigation.classList.contains("is-open")
        ) {
            closeMenu();
            menuButton.focus();
        }
    });

    navigation.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", closeMenu);
    });
});
