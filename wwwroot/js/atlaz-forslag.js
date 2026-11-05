// Förslag på frågor som knappar. Ett klick skickar förslaget som en fråga till Atlaz.

export function createSuggestions(list, onPick) {

    // aria-disabled i stället för disabled, så att knappen man klickade på behåller fokus
    let isDisabled = false;

    // Byter ut frågorna. Fasta knappar, som Kör apport, ligger kvar sist i listan.
    function show(questions) {
        const hadFocus = list.contains(document.activeElement);

        for (const item of list.querySelectorAll("li:not(.ask-atlaz-suggestion-fixed)")) {
            item.remove();
        }

        list.prepend(...questions.map((text, index) => {
            const item = document.createElement("li");
            const button = document.createElement("button");

            button.type = "button";
            button.className = "ask-atlaz-suggestion";
            button.textContent = text;
            button.style.setProperty("--order", index);
            button.setAttribute("aria-disabled", String(isDisabled));
            button.addEventListener("click", () => {
                if (!isDisabled) {
                    onPick(text);
                }
            });

            item.append(button);
            return item;
        }));

        // Den som använder tangentbord hamnar på det första nya förslaget
        if (hadFocus) {
            list.querySelector("button")?.focus();
        }
    }

    // Knapparna går inte att trycka på medan Atlaz väntar på ett svar
    function setDisabled(value) {
        isDisabled = value;

        for (const button of list.querySelectorAll("button")) {
            button.setAttribute("aria-disabled", String(value));
        }
    }

    return { show, setDisabled };
}
