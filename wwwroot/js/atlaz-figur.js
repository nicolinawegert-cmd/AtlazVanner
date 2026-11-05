// Styr bilden på Atlaz. Själva rörelserna ligger i _ask-atlaz-stage.scss.
//
// Läget (data-state på scenen) är det Atlaz håller på med en längre stund:
//   idle      sitter och andas, lägger ibland huvudet på sned
//   thinking  nosar på frågan
//   talking   skäller och pratar
//
// En rörelse (data-move på figuren) spelas en gång, till exempel ett hopp vid varje voff.
//
// Humöret (data-mood på scenen) kommer från AI:n och ändrar hur han sitter mellan svaren.

const MOODS = {
    happy: { label: "Glad", emoji: "😊", move: "wiggle" },
    curious: { label: "Nyfiken", emoji: "🤔", move: "tilt" },
    playful: { label: "Busig", emoji: "😜", move: "jump" },
    tired: { label: "Trött", emoji: "😴", move: "yawn" },
    worried: { label: "Orolig", emoji: "😟", move: null }
};

// Handlingar inom stjärnor i hundspråket, till exempel *lägger huvudet på sned*, blir rörelser
const ACTION_MOVES = [
    { pattern: /rullar/, move: "roll" },
    { pattern: /hopp|studs|skutt/, move: "jump" },
    { pattern: /sned/, move: "tilt" },
    { pattern: /viftar|svans/, move: "wiggle" },
    { pattern: /skakar/, move: "shake" },
    { pattern: /nosar|sniffar/, move: "sniff" },
    { pattern: /gäsp|lägger sig|vilar|korgen/, move: "yawn" }
];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function createAtlazFigure(stage) {
    const figure = stage.querySelector(".ask-atlaz-figure");
    const moodBadge = stage.querySelector(".ask-atlaz-mood");

    // Var Atlaz står i sidled, i pixlar från scenens vänsterkant. null betyder i mitten.
    let position = null;
    let runs = 0;

    figure.addEventListener("animationend", (event) => {
        if (event.target === figure) {
            delete figure.dataset.move;
        }
    });

    function setState(state) {
        stage.dataset.state = state;
    }

    function play(move) {
        // Tar bort rörelsen först så att samma rörelse kan spelas flera gånger i rad
        delete figure.dataset.move;
        void figure.offsetWidth;
        figure.dataset.move = move;
    }

    function act(action) {
        const text = action.toLowerCase();
        const match = ACTION_MOVES.find((item) => item.pattern.test(text));

        if (match) {
            play(match.move);
        }
    }

    // Okända humör, till exempel från ett gammalt svar, blir glad
    function setMood(mood) {
        const name = Object.hasOwn(MOODS, mood) ? mood : "happy";
        const emoji = document.createElement("span");

        emoji.setAttribute("aria-hidden", "true");
        emoji.textContent = MOODS[name].emoji;

        stage.dataset.mood = name;
        moodBadge.replaceChildren(emoji, ` ${MOODS[name].label}`);
        moodBadge.hidden = false;
    }

    // Rörelsen som passar humöret, till exempel att han viftar när han är glad
    function showMood() {
        const move = MOODS[stage.dataset.mood]?.move;

        if (move) {
            play(move);
        }
    }

    // Bilden tittar åt vänster, så den spegelvänds när han ska åt höger
    function face(direction) {
        figure.style.scale = direction === "right" ? "-1 1" : "";
    }

    // Springer till x, i pixlar från scenens vänsterkant, och väntar tills han är framme.
    // Han stannar innan han springer ut ur scenen.
    function runTo(x, speed) {
        const width = stage.clientWidth;
        const half = figure.offsetWidth / 2;
        const from = position ?? width / 2;
        const to = Math.min(Math.max(x, half), width - half);
        const seconds = reducedMotion.matches ? 0 : Math.max(0.3, Math.abs(to - from) / speed);
        const run = ++runs;

        if (Math.abs(to - from) > 2) {
            face(to > from ? "right" : "left");
        }

        position = to;
        stage.dataset.running = "true";
        figure.style.setProperty("--run-time", `${seconds}s`);
        figure.style.translate = `${to - width / 2}px 0`;

        return new Promise((resolve) => {
            setTimeout(() => {
                // En senare löptur får bestämma själv när han slutar springa
                if (run === runs) {
                    delete stage.dataset.running;
                }

                resolve();
            }, seconds * 1000);
        });
    }

    // Tillbaka till mitten, som innan leken
    function resetPosition() {
        position = null;
        runs++;
        delete stage.dataset.running;
        figure.style.removeProperty("--run-time");
        figure.style.translate = "";
        figure.style.scale = "";
    }

    return { setState, play, act, setMood, showMood, face, runTo, resetPosition };
}
