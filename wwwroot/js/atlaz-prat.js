// Atlaz pratbubbla. Hundspråket skrivs fram bit för bit, och varje skall hörs
// och syns i samma stund som ordet kommer upp i bubblan.

const CHARACTER_DELAY = 30;
const ACTION_PAUSE = 300;

// Svenskan är oftast längre än hundspråket, så den skrivs fram lite snabbare
const TRANSLATION_CHARACTER_DELAY = 18;

// Hur länge Atlaz väntar efter ett ljud innan nästa ord kommer
const SOUND_PAUSES = { bark: 300, yip: 180, growl: 750, howl: 1300 };

// Hur figuren rör sig till varje ljud
const SOUND_MOVES = { bark: "hop", yip: "hop", growl: "rumble", howl: "howl" };

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Vilket ljud ett hundord ska låta som, till exempel "VOFF!" eller "aoooo"
function soundForWord(word) {
    const letters = word.toLowerCase().replace(/[^a-zåäö]/g, "");

    if (/^g+r+/.test(letters)) {
        return "growl";
    }

    if (/^a+[ouh]+/.test(letters)) {
        return "howl";
    }

    if (/^[vw]i+f+/.test(letters)) {
        return "yip";
    }

    if (/^[vwb][oua]+[fv]+/.test(letters)) {
        return "bark";
    }

    return null;
}

// Vissa handlingar inom stjärnor hörs också, till exempel *gnyr*
function soundForAction(action) {
    const text = action.toLowerCase();

    if (/gnyr|piper|gnäller/.test(text)) {
        return "whine";
    }

    if (/morrar/.test(text)) {
        return "growl";
    }

    if (/ylar/.test(text)) {
        return "howl";
    }

    return null;
}

// Ett ord skriket med versaler, som "VOFF", skälls högre
function isShouting(word) {
    return /[A-ZÅÄÖ]{2}/.test(word) && word === word.toUpperCase();
}

// Delar upp hundspråket i ljud och handlingar, till exempel "Voff!" och "*viftar på svansen*"
function splitBark(text) {
    return text
        .split(/(\*[^*]+\*)/)
        .filter(Boolean)
        .map((part) => ({ text: part, isAction: part.length > 2 && part.startsWith("*") && part.endsWith("*") }));
}

export function createSpeechBubble(bubble, figure, sounds) {
    const bark = bubble.querySelector(".ask-atlaz-bark");
    const announcer = bubble.querySelector("[aria-live]");
    const translation = bubble.querySelector(".ask-atlaz-translation");
    const link = bubble.querySelector(".ask-atlaz-bubble-link");
    const actions = bubble.querySelector(".ask-atlaz-bubble-actions");
    const status = bubble.querySelector(".ask-atlaz-bubble-status");

    // Räknas upp vid varje nytt svar, så att ett äldre svar slutar skrivas fram
    let current = 0;

    function clear(id) {
        current = id;
        bubble.hidden = false;
        bark.replaceChildren();
        translation.replaceChildren();
        translation.hidden = true;
        link.hidden = true;
        actions.replaceChildren();
        actions.hidden = true;
        status.hidden = true;
    }

    // En kort bekräftelse överst i bubblan, till exempel "Förfrågan skickad"
    function showStatus(text) {
        if (text) {
            status.textContent = text;
            status.hidden = false;
        }
    }

    // Knappar under svaret, till exempel ja och nej när Atlaz frågar om han ska boka.
    // Varje knapp är { text, primary, onClick }.
    function showActions(buttons) {
        for (const { text, primary, onClick } of buttons) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = primary ? "btn-primary" : "ask-atlaz-bubble-secondary";
            button.textContent = text;
            button.addEventListener("click", onClick, { once: true });
            actions.append(button);
        }

        actions.hidden = false;
    }

    async function type(element, text, isCurrent, delay = CHARACTER_DELAY) {
        const node = document.createTextNode("");
        element.append(node);

        if (reducedMotion.matches) {
            node.data = text;
            return;
        }

        for (const character of text) {
            if (!isCurrent()) {
                return;
            }

            node.appendData(character);

            if (character.trim()) {
                await wait(delay);
            }
        }
    }

    // Visas medan Atlaz väntar på något, till exempel svaret från AI:n.
    // state är läget han står i under tiden, announcement det skärmläsare får höra
    // och badge en bekräftelse överst i bubblan.
    function think(text, { state = "thinking", announcement = "Atlaz nosar på din fråga.", badge = null } = {}) {
        clear(current + 1);
        showStatus(badge);

        const action = document.createElement("em");
        action.textContent = text;
        bark.append(action);

        announcer.textContent = announcement;
        figure.setState(state);
    }

    // Hundspråket skrivs fram bit för bit, och varje skall och handling hörs och syns
    async function typeBark(text, isCurrent) {
        for (const piece of splitBark(text)) {
            const element = document.createElement(piece.isAction ? "em" : "span");
            bark.append(element);

            if (piece.isAction) {
                figure.act(piece.text);

                const sound = soundForAction(piece.text);

                if (sound) {
                    sounds.play(sound);
                }

                await type(element, piece.text, isCurrent);
                await wait(ACTION_PAUSE);
            } else {
                // Ett ord i taget, så att skallet hörs precis när ordet börjar
                for (const word of piece.text.split(/(\s+)/)) {
                    const sound = soundForWord(word);

                    if (sound) {
                        sounds.play(sound, { loud: isShouting(word) });
                        figure.play(SOUND_MOVES[sound]);
                    }

                    await type(element, word, isCurrent);

                    if (sound) {
                        await wait(SOUND_PAUSES[sound]);
                    }

                    if (!isCurrent()) {
                        return;
                    }
                }
            }

            if (!isCurrent()) {
                return;
            }
        }
    }

    // answer har samma form som svaret från /api/fraga-atlaz: { bark, translation, mood }.
    // Med answer.link, { href, text }, visas en länk under svaret, med answer.actions knappar
    // och med answer.status en bekräftelse överst.
    // Hundspråket och svenskan skrivs fram samtidigt, lite i taget.
    // Svarar sant om Atlaz hann prata klart och falskt om ett nyare svar tog över.
    async function say(answer) {
        const id = current + 1;
        const isCurrent = () => id === current;

        clear(id);
        showStatus(answer.status);
        translation.hidden = !answer.translation;

        // Skärmläsare får hela svaret på en gång i stället för en bokstav i taget
        announcer.textContent = `Atlaz säger: ${answer.translation || answer.bark}`;
        figure.setMood(answer.mood);
        figure.setState("talking");

        await Promise.all([
            typeBark(answer.bark ?? "", isCurrent),
            type(translation, answer.translation ?? "", isCurrent, TRANSLATION_CHARACTER_DELAY)
        ]);

        if (!isCurrent()) {
            return false;
        }

        // Länken kommer när Atlaz har pratat klart, så att den inte hoppar runt medan texten växer
        if (answer.link) {
            link.href = answer.link.href;
            link.textContent = answer.link.text;
            link.hidden = false;
        }

        if (answer.actions?.length > 0) {
            showActions(answer.actions);
        }

        figure.setState("idle");
        figure.showMood();

        return true;
    }

    return { say, think };
}
