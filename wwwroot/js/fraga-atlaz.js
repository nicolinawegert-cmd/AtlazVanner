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

// Knappen "Föreslå en träff" startar en bokning, och Atlaz frågar sedan efter det som saknas
const MEETUP_QUESTION = "Jag vill föreslå en träff med dig och boka in den!";

// Atlaz första svar på "Föreslå en träff". Det är färdigskrivet så att det kommer direkt utan att
// vänta på AI:n, och det frågar efter allt som behövs på en gång. Resten av bokningen sköter AI:n.
const MEETUP_ANSWER = {
    bark: "Voff voff! *viftar på svansen och hoppar runt*",
    translation: "Vad roligt, jag älskar att träffa nya kompisar! 🐾 När och var vill du att vi ses, och vad ska vi göra? " +
        "Skriv till exempel: imorgon kl 17 i Stadsparken, vi går en promenad.",
    mood: "happy"
};

// Färdiga förslag på träffar. Allt om dem är redan känt, så ett klick går direkt till
// "Ska jag lägga in det?" utan att fråga AI:n. day är "imorgon" eller en veckodag, där 0 är söndag.
const MEETUP_SHORTCUTS = [
    {
        text: "Imorgon kl 17 i Stadsparken, vi går en promenad",
        day: "imorgon",
        time: "17:00",
        place: "Stadsparken",
        name: "Promenad i Stadsparken",
        description: "Vi går en promenad tillsammans i Stadsparken."
    },
    {
        text: "På lördag kl 11 i skogen, vi leker apport",
        day: 6,
        time: "11:00",
        place: "Skogen",
        name: "Apportlek i skogen",
        description: "Vi leker apport i skogen. Ta gärna med en egen pinne eller boll."
    },
    {
        text: "På söndag kl 14 i hundrastgården, vi tränar inkallning",
        day: 0,
        time: "14:00",
        place: "Hundrastgården",
        name: "Inkallningsträning i hundrastgården",
        description: "Vi tränar inkallning i hundrastgården. Ta med godis som belöning."
    }
];

const MEETUP_SUGGESTIONS = MEETUP_SHORTCUTS.map((shortcut) => shortcut.text);

const MEETUP_CANCELLED = {
    bark: "*lägger huvudet på sned* Vov!",
    translation: "Okej, då väntar vi med träffen. Fråga mig något annat om hundlivet, eller föreslå en träff igen när du vill! 🐾",
    mood: "curious"
};

// En bokning som precis har börjat, där Atlaz inte vet något än
const EMPTY_BOOKING = { name: null, date: null, time: null, place: null, description: null, ready: false };

// Så många tidigare repliker skickas med, så att Atlaz minns vad ni har pratat om
const MAX_HISTORY = 8;

// Så länge Atlaz hoppar av glädje innan han berättar. Samma tid som hoppet "joy" i _ask-atlaz-stage.scss.
const JOY_TIME = 1800;

const REQUEST_SENT = "Förfrågan skickad";

const BOOKING_DECLINED = {
    bark: "*lägger huvudet på sned* Vov?",
    translation: "Okej, jag väntar med att lägga in den. Skriv om du vill ändra något, till exempel tiden eller platsen, så fixar vi det. 🐾",
    mood: "curious"
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Datumet imorgon, eller nästa gång en veckodag kommer, till exempel 2026-11-14
function shortcutDate(day) {
    const date = new Date();
    const daysAhead = day === "imorgon" ? 1 : (day - date.getDay() + 7) % 7 || 7;
    const pad = (number) => String(number).padStart(2, "0");

    date.setDate(date.getDate() + daysAhead);

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Till exempel "fredag 13 november kl. 17.00"
function describeTime(date, time) {
    const day = new Date(`${date}T${time}`);
    const dayText = day.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long" });

    return `${dayText} kl. ${time.replace(":", ".")}`;
}

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
    const questionLabel = form.querySelector("label[for='ask-atlaz-question']");
    const suggestionsTitle = form.querySelector("#ask-atlaz-suggestions-title");
    const fetchPanel = document.querySelector(".ask-atlaz-fetch");
    const throwButton = fetchPanel.querySelector(".ask-atlaz-throw");
    const stopButton = fetchPanel.querySelector(".ask-atlaz-stop-fetch");
    const fetchCount = fetchPanel.querySelector(".ask-atlaz-fetch-count");

    const figure = createAtlazFigure(stage);
    const sounds = createAtlazSounds(JSON.parse(stage.dataset.barkSounds || "[]"));
    const bubble = createSpeechBubble(stage.querySelector(".ask-atlaz-bubble"), figure, sounds);
    const suggestions = createSuggestions(form.querySelector(".ask-atlaz-suggestion-list"), (text) => {
        const shortcut = MEETUP_SHORTCUTS.find((item) => item.text === text);

        // Ett färdigt träffförslag behöver ingen AI
        if (shortcut && isAnswering()) {
            bookShortcut(shortcut);
            return;
        }

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

    // Samtalet hittills, som { role: "visitor" | "atlaz", text }
    let history = [];

    // Det Atlaz har fyllt i om en bokning som pågår, annars null
    let booking = null;

    // Förslagen som syns just nu, och de som syntes innan bokningen började.
    // De senare kommer tillbaka när bokningen är klar eller avbryts.
    let currentSuggestions = [];
    let suggestionsBeforeBooking = null;

    // Räknas upp när en bokning tar slut, så att ett svar som kommer efteråt inte startar den igen
    let bookingRound = 0;

    function showSuggestions(questions) {
        currentSuggestions = questions;
        suggestions.show(questions);
    }

    // Alla ändringar av bokningen går hit, så att knappen och texterna alltid stämmer
    function setBooking(next) {
        if (booking === null && next !== null) {
            suggestionsBeforeBooking = { questions: currentSuggestions, fromAtlaz: hasAtlazSuggestions };
        }

        booking = next;
        showMode();
    }

    // Bokningen är klar eller avbruten, så förslagen från innan den började kommer tillbaka
    function endBooking() {
        const before = suggestionsBeforeBooking;

        bookingRound++;
        setBooking(null);
        suggestionsBeforeBooking = null;
        hasAtlazSuggestions = before?.fromAtlaz ?? false;
        showSuggestions(hasAtlazSuggestions ? before.questions : STARTER_QUESTIONS[selectedVisitor()]);
    }

    function cancelBooking() {
        endBooking();
        remember("Jag vill inte boka något just nu.", MEETUP_CANCELLED.translation);
        bubble.say(MEETUP_CANCELLED);
    }

    function remember(visitorText, atlazText) {
        history = [...history, { role: "visitor", text: visitorText }, { role: "atlaz", text: atlazText }].slice(-MAX_HISTORY);
    }

    // Medan en bokning pågår är det Atlaz som ställer frågor, så då svarar man i stället för att fråga
    const isAnswering = () => booking !== null;

    function showMode() {
        // "Föreslå en träff" ser vald ut medan bokningen pågår, och ett klick på den avbryter
        meetChip.setAttribute("aria-pressed", String(isAnswering()));
        meetChip.title = isAnswering() ? "Avbryt träffen" : "";
        questionLabel.textContent = isAnswering() ? "Eller skriv ditt svar till Atlaz" : "Eller skriv din egen fråga";
        suggestionsTitle.textContent = isAnswering() ? "Förslag på svar" : "Förslag";

        if (!submitButton.disabled) {
            submitButton.textContent = isAnswering() ? "Svara Atlaz" : "Fråga Atlaz";
        }
    }

    // Formuläret och förslagen är låsta medan Atlaz jobbar, och knappen säger vad han gör
    function setBusy(isBusy, busyText = "") {
        submitButton.disabled = isBusy;
        suggestions.setDisabled(isBusy);

        if (isBusy) {
            submitButton.textContent = busyText;
        } else {
            showMode();
        }
    }

    // Ja- och nej-knapparna under Atlaz fråga "Ska jag lägga in det?"
    function bookingActions() {
        return [
            { text: "Ja, lägg in det", primary: true, onClick: confirmBooking },
            { text: "Nej, vänta", primary: false, onClick: declineBooking }
        ];
    }

    // "Förfrågan skickad" visas direkt och Atlaz hoppar av glädje. Sedan berättar han vad som har skickats.
    async function celebrate(text, link = null) {
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        bubble.think("*hoppar av glädje*", { state: "idle", announcement: `${REQUEST_SENT}.`, badge: REQUEST_SENT });
        figure.setMood("playful");
        figure.play("joy");
        sounds.play("bark", { loud: true });
        await wait(reducedMotion ? 0 : JOY_TIME);

        return bubble.say({
            status: REQUEST_SENT,
            bark: "VOFF VOFF! *viftar glatt på svansen*",
            translation: text,
            mood: "playful",
            link
        });
    }

    // Atlaz springer iväg med förfrågan och hoppar av glädje när den har kommit fram
    async function confirmBooking() {
        const draft = booking;
        let result = null;
        let problem = null;

        sounds.unlock();
        setBusy(true, "Atlaz skickar förfrågan…");
        bubble.think("*springer iväg med förfrågan i munnen*", { announcement: "Atlaz skickar förfrågan." });
        showStage();

        try {
            const response = await fetch("/api/fraga-atlaz/boka", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...draft, pageKey: form.dataset.pageKey })
            });
            const data = await response.json().catch(() => null);

            if (response.ok) {
                result = data;
            } else {
                problem = data?.message ?? "Något gick fel.";
            }
        } catch {
            problem = "Jag fick ingen kontakt med föreningen.";
        }

        setBusy(false);

        if (result) {
            // Platsen står ofta redan i namnet, till exempel "Promenad i Stadsparken"
            const place = result.name.toLowerCase().includes(result.place.toLowerCase())
                ? ""
                : ` Platsen är ${result.place}.`;
            const translation = `Jag har skickat en förfrågan om ${result.name}, ${describeTime(result.date, result.time)}.${place} ` +
                "Nu tittar föreningen på den, och tills dess syns den som väntande på aktivitetssidan. 🐾";

            endBooking();
            remember("Ja, lägg in det", translation);
            await celebrate(translation, result.activitiesUrl ? { href: result.activitiesUrl, text: "Se förfrågan på aktivitetssidan" } : null);
        } else {
            await bubble.say({
                bark: "*gnyr* *lägger huvudet på sned*",
                translation: `Oj, förfrågan gick inte att skicka. ${problem} Vill du att jag försöker igen?`,
                mood: "worried",
                actions: bookingActions()
            });
        }
    }

    // Ett färdigt träffförslag fyller i hela bokningen direkt, och Atlaz frågar om han ska lägga in den
    function bookShortcut(shortcut) {
        const date = shortcutDate(shortcut.day);
        const translation = `Toppen! ${shortcut.name}, ${describeTime(date, shortcut.time)}. ${shortcut.description} Ska jag lägga in det? 🐾`;

        sounds.unlock();
        showStage();
        remember(shortcut.text, translation);
        setBooking({
            name: shortcut.name,
            date,
            time: shortcut.time,
            place: shortcut.place,
            description: shortcut.description,
            ready: true
        });
        showSuggestions([]);
        bubble.say({
            bark: "Voff! *viftar på svansen*",
            translation,
            mood: "happy",
            actions: bookingActions()
        });
    }

    async function declineBooking() {
        setBooking({ ...booking, ready: false });
        remember("Nej, vänta", BOOKING_DECLINED.translation);
        await bubble.say(BOOKING_DECLINED);
        question.focus();
    }

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
        showSuggestions(STARTER_QUESTIONS[selectedVisitor()]);
        form.querySelector("input[name='visitor']:checked").focus();
        bubble.say(GREETING);
    });

    // Startar en bokning direkt, utan att vänta på AI:n. Pågår redan en bokning avbryts den i stället.
    meetChip.addEventListener("click", async () => {
        if (meetChip.getAttribute("aria-disabled") === "true") {
            return;
        }

        sounds.unlock();
        showStage();

        if (isAnswering()) {
            cancelBooking();
            return;
        }

        setBooking({ ...EMPTY_BOOKING });
        remember(MEETUP_QUESTION, MEETUP_ANSWER.translation);

        // Tidsförslagen kommer direkt i stället för de gamla frågorna, utan att vänta på att Atlaz pratat klart
        hasAtlazSuggestions = true;
        showSuggestions(MEETUP_SUGGESTIONS);
        bubble.say(MEETUP_ANSWER);
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
        if (event.target.name !== "visitor") {
            return;
        }

        // Den som byter mellan människa och hund börjar om, så en pågående bokning avbryts
        if (isAnswering()) {
            cancelBooking();
        } else if (!hasAtlazSuggestions) {
            showSuggestions(STARTER_QUESTIONS[selectedVisitor()]);
        }
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!form.reportValidity()) {
            return;
        }

        const visitor = selectedVisitor();
        const asked = question.value;
        const round = bookingRound;
        let answer;
        let failed = false;

        sounds.unlock();
        setBusy(true, isAnswering() ? "Atlaz läser ditt svar…" : "Atlaz nosar på din fråga…");
        bubble.think(isAnswering() ? "*spetsar öronen och lyssnar*" : "*nosar nyfiket på din fråga*");
        showStage();

        try {
            const response = await fetch("/api/fraga-atlaz", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: asked,
                    visitor: visitor,
                    pageKey: form.dataset.pageKey,
                    history,
                    booking
                })
            });

            if (!response.ok) {
                throw new Error(`Svaret hade status ${response.status}`);
            }

            answer = await response.json();
        } catch {
            answer = ERROR_ANSWER;
            failed = true;
        } finally {
            setBusy(false);
        }

        // Bokningen avbröts medan Atlaz tänkte, så svaret hör inte till samtalet längre
        if (round !== bookingRound) {
            return;
        }

        // Reservsvar och fel kommer inte från AI:n, så de ska inte bli en del av samtalet
        if (!failed && !answer.fallback) {
            remember(asked, answer.translation);
            setBooking(answer.booking ?? null);
            question.value = "";
        }

        const finished = await bubble.say({
            ...answer,
            actions: booking?.ready ? bookingActions() : null
        });

        // Nya förslag visas först när Atlaz har pratat klart.
        // Medan han frågar om han ska lägga in bokningen är det bara ja och nej som gäller.
        if (finished && booking?.ready) {
            showSuggestions([]);
        } else if (finished && answer.suggestions?.length > 0) {
            hasAtlazSuggestions = true;
            showSuggestions(answer.suggestions);
        }
    });
}
