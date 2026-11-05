// Apport! Knappen "Kör apport" flyger upp på scenen och blir en pinne. Man drar pinnen
// och släpper den för att kasta, och Atlaz springer, hämtar den och kommer tillbaka.
//
// Pinnens bana räknas ut i förväg när man släpper den. Då vet Atlaz direkt var den
// kommer att landa och kan börja springa medan den fortfarande är i luften.

const GRAVITY = 2200;           // pixlar per sekund i kvadrat
const MAX_SPEED = 2600;         // pixlar per sekund
const RUN_SPEED = 650;          // hur fort Atlaz springer, pixlar per sekund
const STEP = 1 / 120;           // sekunder mellan punkterna i den uträknade banan
const STICK_WIDTH = 100;
const STICK_HEIGHT = 44;
const GROUND_OFFSET = 64;       // hur högt över scenens nederkant pinnen ligger, ovanför knapparna i gräset

const STICK_SVG = `
    <svg viewBox="0 0 100 24" aria-hidden="true" focusable="false">
        <path d="M5 15 C30 11 60 10 95 13" fill="none" stroke="#7a4b22" stroke-width="8" stroke-linecap="round" />
        <path d="M9 14 C32 10.5 60 9.5 91 12" fill="none" stroke="#a8743f" stroke-width="3" stroke-linecap="round" />
        <path d="M62 10.5 L74 3" fill="none" stroke="#7a4b22" stroke-width="4" stroke-linecap="round" />
    </svg>`;

const LINES = {
    start: {
        bark: "VOFF VOFF! *hoppar upp*",
        translation: "En pinne! Dra pinnen och släpp den, så springer jag och hämtar den!"
    },
    chase: [
        { bark: "VOFF!", translation: "Jag tar den!" },
        { bark: "Wiff wiff!", translation: "Den är min, den är min!" },
        { bark: "Voff!", translation: "Här kommer jag!" }
    ],
    back: [
        { bark: "Voff voff! *viftar på svansen*", translation: "Igen! Igen! Kasta en gång till!" },
        { bark: "VOFF! *hoppar runt*", translation: "Vilket kast! Mer, mer!" },
        { bark: "Wiff! *lägger huvudet på sned*", translation: "Här är den, den bästa pinnen i hela världen." }
    ],
    lost: {
        bark: "*nosar i buskarna* Wiff?",
        translation: "Var tog den vägen? Den luktar ju alldeles här någonstans…"
    },
    found: {
        bark: "VOFF! *viftar på svansen*",
        translation: "Där var den!"
    },
    stop: {
        bark: "*lägger sig och flämtar* Voff.",
        translation: "Tack för leken! Nu kan du fråga mig något igen. 🐾",
        mood: "happy"
    }
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Räknar ut pinnens väg genom luften tills den ligger still i gräset eller flyger ut ur scenen
function simulate(start, vx, vy, width, ground) {
    const speed = Math.hypot(vx, vy);

    if (speed > MAX_SPEED) {
        vx *= MAX_SPEED / speed;
        vy *= MAX_SPEED / speed;
    }

    let { x, y, angle } = start;
    let spin = vx * 0.5;
    const path = [];

    for (let time = 0; time < 5; time += STEP) {
        vy += GRAVITY * STEP;
        x += vx * STEP;
        y += vy * STEP;
        angle += spin * STEP;

        if (x < -STICK_WIDTH / 2 || x > width + STICK_WIDTH / 2) {
            path.push({ x, y, angle });
            return { path, lostSide: x < 0 ? "left" : "right" };
        }

        if (y >= ground && vy > 0) {
            y = ground;

            // Studsar lite i gräset och lägger sig sedan ner
            if (vy < 250) {
                path.push({ x, y, angle: Math.round(angle / 180) * 180 });
                return { path, lostSide: null };
            }

            vy = -vy * 0.35;
            vx *= 0.6;
            spin *= 0.5;
        }

        path.push({ x, y, angle });
    }

    return { path, lostSide: null };
}

// say(line) får Atlaz att säga något i pratbubblan.
// onChange({ count, canThrow }) anropas när antalet apporter eller läget ändras.
export function createFetchGame({ stage, figure, sounds, say, onChange }) {
    const figureElement = stage.querySelector(".ask-atlaz-figure");
    const pose = stage.querySelector(".ask-atlaz-pose");
    const resizeObserver = new ResizeObserver(() => keepStickOnGround());

    let stick = null;
    let carried = null;
    let hint = null;
    let drag = null;
    let count = 0;
    let canThrow = false;
    let position = { x: 0, y: 0, angle: 0 };

    // Räknas upp när leken startar eller slutar, så att animationer från en gammal lek avbryts
    let round = 0;

    const groundY = () => stage.clientHeight - GROUND_OFFSET;
    const homeX = () => stage.clientWidth * 0.32;
    const restX = () => Math.min(stage.clientWidth - STICK_WIDTH / 2, homeX() + stage.clientWidth * 0.4);

    function setCanThrow(value) {
        canThrow = value;
        stick?.toggleAttribute("data-busy", !value);
        // Scenen kan ha bytt höjd medan pinnen flög eller bars, så den läggs på marken igen
        keepStickOnGround();
        onChange({ count, canThrow });
    }

    function placeStick(point) {
        position = point;
        stick.style.transform =
            `translate(${point.x - STICK_WIDTH / 2}px, ${point.y - STICK_HEIGHT / 2}px) rotate(${point.angle}deg)`;
    }

    function createStick() {
        const element = document.createElement("div");
        element.className = "ask-atlaz-stick";
        element.innerHTML = STICK_SVG;
        element.hidden = true;
        element.addEventListener("pointerdown", startDrag);
        element.addEventListener("pointermove", moveDrag);
        element.addEventListener("pointerup", endDrag);
        element.addEventListener("pointercancel", endDrag);
        return element;
    }

    function showHint() {
        hint = document.createElement("p");
        hint.className = "ask-atlaz-stick-hint";
        hint.setAttribute("aria-hidden", "true");
        hint.textContent = "Dra och släpp pinnen!";
        hint.style.left = `${position.x}px`;
        hint.style.top = `${position.y - STICK_HEIGHT / 2}px`;
        stage.append(hint);
    }

    function hideHint() {
        hint?.remove();
        hint = null;
    }

    // Scenen blir högre när pratbubblan växer, och då ska en pinne som ligger still följa med gräset
    function keepStickOnGround() {
        if (stick && canThrow && !drag) {
            placeStick({ ...position, x: Math.min(position.x, stage.clientWidth - STICK_WIDTH / 2), y: groundY() });
            hint?.style.setProperty("top", `${position.y - STICK_HEIGHT / 2}px`);
        }
    }

    // Spelar upp den uträknade banan. Svarar falskt om leken avbröts under tiden.
    function fly(path, id) {
        if (reducedMotion.matches) {
            placeStick(path.at(-1));
            return Promise.resolve(id === round);
        }

        return new Promise((resolve) => {
            const startTime = performance.now();

            function frame(now) {
                if (id !== round) {
                    resolve(false);
                    return;
                }

                // now kan ligga en aning före startTime i den första bilden, därför clamp
                const index = clamp(Math.floor((now - startTime) / 1000 / STEP), 0, path.length - 1);
                placeStick(path[index]);

                if (index === path.length - 1) {
                    resolve(true);
                } else {
                    requestAnimationFrame(frame);
                }
            }

            requestAnimationFrame(frame);
        });
    }

    // Knappen flyger upp på scenen och förvandlas till en pinne på vägen
    async function morph(from, to, label) {
        if (!from || reducedMotion.matches) {
            return;
        }

        const stageBox = stage.getBoundingClientRect();
        const end = { left: stageBox.left + to.x - 45, top: stageBox.top + to.y - 7 };
        const ghost = document.createElement("div");

        ghost.className = "ask-atlaz-stick-ghost";
        ghost.setAttribute("aria-hidden", "true");
        ghost.textContent = label;
        document.body.append(ghost);

        const animation = ghost.animate([
            {
                left: `${from.left}px`,
                top: `${from.top}px`,
                width: `${from.width}px`,
                height: `${from.height}px`,
                borderRadius: "999px",
                borderColor: "#d2dfca",
                backgroundColor: "#fffdf8",
                color: "#304b34",
                rotate: "0deg"
            },
            {
                offset: 0.5,
                left: `${(from.left + end.left) / 2}px`,
                top: `${Math.min(from.top, end.top) - 80}px`,
                width: "90px",
                height: "14px",
                borderRadius: "7px",
                borderColor: "#7a4b22",
                backgroundColor: "#8a5a2b",
                color: "transparent"
            },
            {
                left: `${end.left}px`,
                top: `${end.top}px`,
                width: "90px",
                height: "14px",
                borderRadius: "7px",
                borderColor: "#7a4b22",
                backgroundColor: "#8a5a2b",
                color: "transparent",
                rotate: "712deg"
            }
        ], { duration: 900, easing: "ease-in-out" });

        await animation.finished;
        ghost.remove();
    }

    async function start(from, label) {
        if (stick) {
            return;
        }

        const id = ++round;

        // Atlaz krymper i apportläget och pratbubblan byts ut, och då blir scenen lägre.
        // Den behåller sin höjd under leken, annars flyttar sig marken medan pinnen flyger
        // dit och pinnen hamnar under gräset där den inte går att ta.
        stage.style.minHeight = `${stage.offsetHeight}px`;

        count = 0;
        stage.dataset.mode = "fetch";
        stick = createStick();
        carried = document.createElement("span");
        carried.className = "ask-atlaz-carried-stick";
        carried.innerHTML = STICK_SVG;
        carried.hidden = true;
        stage.append(stick);
        pose.append(carried);
        resizeObserver.observe(stage);
        setCanThrow(false);

        say({ ...LINES.start, mood: "playful" });

        const rest = { x: restX(), y: groundY(), angle: -8 };
        await Promise.all([morph(from, rest, label), figure.runTo(homeX(), RUN_SPEED)]);

        if (id !== round) {
            return;
        }

        figure.face("right");
        stick.hidden = false;
        placeStick(rest);
        showHint();
        setCanThrow(true);
    }

    async function throwStick(vx, vy) {
        if (!canThrow) {
            return;
        }

        const id = round;
        const { path, lostSide } = simulate(position, vx, vy, stage.clientWidth, groundY());
        const landing = path.at(-1);

        setCanThrow(false);
        hideHint();
        say({ ...pick(LINES.chase), mood: "playful" });

        const flight = fly(path, id);

        // Atlaz reagerar en kort stund efter kastet och springer dit pinnen kommer att landa
        await wait(150);

        if (id !== round) {
            return;
        }

        const target = lostSide === "left" ? 0 : lostSide === "right" ? stage.clientWidth : landing.x;
        await Promise.all([flight, figure.runTo(target, RUN_SPEED)]);

        if (id !== round) {
            return;
        }

        figure.play("sniff");

        if (lostSide) {
            say({ ...LINES.lost, mood: "curious" });
            await wait(2200);

            if (id !== round) {
                return;
            }

            say({ ...LINES.found, mood: "playful" });
        }

        await wait(400);

        if (id !== round) {
            return;
        }

        // Pinnen i munnen
        stick.hidden = true;
        carried.hidden = false;
        sounds.play("growl");

        await figure.runTo(homeX(), RUN_SPEED);

        if (id !== round) {
            return;
        }

        // Släpper pinnen framför sig
        const figureBox = figureElement.getBoundingClientRect();
        const stageBox = stage.getBoundingClientRect();
        const mouth = {
            x: homeX() + figureBox.width * 0.25,
            y: Math.min(groundY(), figureBox.top - stageBox.top + figureBox.height * 0.62),
            angle: -8
        };

        figure.face("right");
        carried.hidden = true;
        stick.hidden = false;
        placeStick(mouth);

        const dropped = await fly(simulate(mouth, 260, -200, stage.clientWidth, groundY()).path, id);

        if (!dropped) {
            return;
        }

        count++;
        say({ ...pick(LINES.back), mood: "playful" });
        setCanThrow(true);
    }

    // För den som inte kan dra, till exempel med tangentbordet
    function throwRandom() {
        const direction = Math.random() < 0.5 ? -1 : 1;
        throwStick(direction * (600 + Math.random() * 900), -(800 + Math.random() * 600));
    }

    function startDrag(event) {
        if (!canThrow) {
            return;
        }

        event.preventDefault();
        stick.setPointerCapture(event.pointerId);
        hideHint();

        const box = stage.getBoundingClientRect();

        drag = {
            box,
            offsetX: event.clientX - box.left - position.x,
            offsetY: event.clientY - box.top - position.y,
            samples: []
        };
    }

    function moveDrag(event) {
        if (!drag) {
            return;
        }

        const x = clamp(event.clientX - drag.box.left - drag.offsetX, 0, stage.clientWidth);
        const y = clamp(event.clientY - drag.box.top - drag.offsetY, 10, groundY());

        placeStick({ x, y, angle: position.angle });
        drag.samples.push({ time: event.timeStamp, x, y });

        // Bara slutet av rörelsen räknas, så att det är svepet precis innan man släpper som avgör kastet
        while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].time > 100) {
            drag.samples.shift();
        }
    }

    function endDrag(event) {
        if (!drag) {
            return;
        }

        const { samples } = drag;
        drag = null;

        // Ett klick utan att dra kastar ingenting
        if (samples.length === 0) {
            showHint();
            return;
        }

        const first = samples[0];
        const last = samples.at(-1);
        const seconds = (last.time - first.time) / 1000;

        // Om man höll pinnen still innan man släppte faller den bara ner
        const isStill = seconds <= 0 || event.timeStamp - last.time > 100;

        throwStick(
            isStill ? 0 : (last.x - first.x) / seconds,
            isStill ? 0 : (last.y - first.y) / seconds);
    }

    function stop() {
        if (!stick) {
            return;
        }

        round++;
        drag = null;
        canThrow = false;
        resizeObserver.disconnect();
        hideHint();
        stick.remove();
        carried.remove();
        stick = null;
        carried = null;
        delete stage.dataset.mode;
        stage.style.minHeight = "";
        figure.resetPosition();

        say(LINES.stop);
    }

    return { start, stop, throwRandom };
}
