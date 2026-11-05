import { createAtlazFigure } from "./atlaz-figur.js";
import { createAtlazSounds } from "./atlaz-ljud.js";
import { createSpeechBubble } from "./atlaz-prat.js";
import { createSuggestions } from "./atlaz-forslag.js";
import { createFetchGame } from "./atlaz-apport.js";

const GREETING = {
    bark: "*hoppar upp* Voff! Voff voff! *viftar på svansen*",
    translation: "Hej, vad roligt att du vill prata med mig! Berätta om du är människa eller hund, och välj en fråga eller skriv en egen. 🐾",
    mood: "happy"
};

const ERROR_ANSWER = {
    bark: "*gnyr* *lägger huvudet på sned*",
    translation: "Något gick fel och jag hörde inte din fråga. Försök igen om en stund!",
    mood: "worried"
};

// Förslag innan Atlaz själv har hunnit föreslå något
const STARTER_QUESTIONS = {
    human: [
        "Vad gillar du mest att leka?",
        "Hur vet jag att min hund är glad?",
        "Hur hälsar man fint på en hund?"
    ],
    dog: [
        "Hur får jag mer godis?",
        "Varför är dammsugaren så läskig?",
        "Hur får jag min människa att gå ut?"
    ]
};

const MEETUP_QUESTION = "Jag vill föreslå en träff med dig! När och var kan vi ses?";

// Frågor om att ses får en länk till kontaktsidan, där föreningens träffar står
const isAboutMeeting = (text) => /träff|träffas|\bses\b/i.test(text);

const stage = document.querySelector(".ask-atlaz-stage");
const form = document.querySelector(".ask-atlaz-form");

if (stage && form) {
    setUpAskAtlaz(stage, form);
}

function setUpAskAtlaz(stage, form) {
    const startButton = document.querySelector(".ask-atlaz-start");
    const soundButton = stage.querySelector(".ask-atlaz-sound");
    const submitButton = form.querySelector(".ask-atlaz-submit");
    const question = form.querySelector("#ask-atlaz-question");
    const fetchChip = form.querySelector(".ask-atlaz-fetch-chip");
    const meetChip = form.querySelector(".ask-atlaz-meet-chip");
    const contactUrl = form.dataset.contactUrl;
    const fetchPanel = document.querySelector(".ask-atlaz-fetch");
    const throwButton = fetchPanel.querySelector(".ask-atlaz-throw");
    const stopButton = fetchPanel.querySelector(".ask-atlaz-stop-fetch");
    const fetchCount = fetchPanel.querySelector(".ask-atlaz-fetch-count");

    const figure = createAtlazFigure(stage);
    const sounds = createAtlazSounds(JSON.parse(stage.dataset.barkSounds || "[]"));
    const bubble = createSpeechBubble(stage.querySelector(".ask-atlaz-bubble"), figure, sounds);
    const suggestions = createSuggestions(form.querySelector(".ask-atlaz-suggestion-list"), (text) => {
        question.value = text;
        form.requestSubmit();
    });
    const game = createFetchGame({
        stage,
        figure,
        sounds,
        say: (line) => bubble.say(line),
        onChange: ({ count, canThrow }) => {
            fetchCount.textContent = `Apporter: ${count}`;
            throwButton.setAttribute("aria-disabled", String(!canThrow));
        }
    });

    // Blir sant när Atlaz har föreslagit egna frågor, så att de inte byts ut mot startförslagen
    let hasAtlazSuggestions = false;

    const selectedVisitor = () => form.querySelector("input[name='visitor']:checked").value;

    function showSoundSetting() {
        const isOn = !sounds.isMuted();

        soundButton.setAttribute("aria-pressed", String(isOn));
        soundButton.querySelector(".ask-atlaz-sound-icon").textContent = isOn ? "🔊" : "🔇";
    }

    // På mobilen ligger Atlaz ovanför formuläret, så sidan scrollar upp till honom om han inte syns
    function showStage() {
        if (stage.getBoundingClientRect().top < 0) {
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            stage.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
        }
    }

    showSoundSetting();

    soundButton.addEventListener("click", () => {
        sounds.unlock();
        sounds.setMuted(!sounds.isMuted());
        showSoundSetting();
    });

    startButton.addEventListener("click", () => {
        sounds.unlock();
        startButton.hidden = true;
        form.hidden = false;
        suggestions.show(STARTER_QUESTIONS[selectedVisitor()]);
        form.querySelector("input[name='visitor']:checked").focus();
        bubble.say(GREETING);
    });

    meetChip.addEventListener("click", () => {
        if (meetChip.getAttribute("aria-disabled") !== "true") {
            question.value = MEETUP_QUESTION;
            form.requestSubmit();
        }
    });

    fetchChip.addEventListener("click", () => {
        if (fetchChip.getAttribute("aria-disabled") === "true") {
            return;
        }

        sounds.unlock();

        // Scenen ska synas innan knappen flyger dit, så sidan hoppar dit direkt utan att glida
        if (stage.getBoundingClientRect().top < 0) {
            stage.scrollIntoView({ behavior: "instant", block: "start" });
        }

        const from = fetchChip.getBoundingClientRect();

        form.hidden = true;
        fetchPanel.hidden = false;
        throwButton.focus({ preventScroll: true });
        game.start(from, fetchChip.textContent.trim());
    });

    throwButton.addEventListener("click", () => game.throwRandom());

    stopButton.addEventListener("click", () => {
        game.stop();
        fetchPanel.hidden = true;
        form.hidden = false;
        fetchChip.focus();
    });

    form.addEventListener("change", (event) => {
        if (event.target.name === "visitor" && !hasAtlazSuggestions) {
            suggestions.show(STARTER_QUESTIONS[selectedVisitor()]);
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!form.reportValidity()) {
            return;
        }

        const visitor = selectedVisitor();
        const link = contactUrl && isAboutMeeting(question.value)
            ? { href: contactUrl, text: "Se föreningens träffar på kontaktsidan" }
            : null;
        let answer;

        sounds.unlock();
        submitButton.disabled = true;
        submitButton.textContent = "Atlaz nosar på din fråga…";
        suggestions.setDisabled(true);
        bubble.think("*nosar nyfiket på din fråga*");
        showStage();

        try {
            const response = await fetch("/api/fraga-atlaz", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: question.value,
                    visitor: visitor,
                    pageKey: form.dataset.pageKey
                })
            });

            if (!response.ok) {
                throw new Error(`Svaret hade status ${response.status}`);
            }

            answer = await response.json();
        } catch {
            answer = ERROR_ANSWER;
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = "Fråga Atlaz";
            suggestions.setDisabled(false);
        }

        const finished = await bubble.say({ ...answer, link });

        // Nya förslag visas först när Atlaz har pratat klart
        if (finished && answer.suggestions?.length > 0) {
            hasAtlazSuggestions = true;
            suggestions.show(answer.suggestions);
        }
    });
}
