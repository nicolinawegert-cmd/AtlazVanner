// Atlaz skall. Finns det inspelade ljudfiler i wwwroot/audio/atlaz används de till
// vanliga skall. Annars, och för morrande, ylande och gnyende, hittar webbläsaren
// på ljuden själv med Web Audio.

const STORAGE_KEY = "atlaz-ljud-av";

export function createAtlazSounds(files) {
    let context = null;
    let output = null;
    let noise = null;
    let recorded = [];
    let muted = readMuted();

    // Webbläsare spelar bara ljud efter att besökaren har klickat,
    // så unlock ska anropas från ett klick
    function unlock() {
        if (!context) {
            const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;

            if (!AudioContextClass) {
                return;
            }

            context = new AudioContextClass();
            output = context.createGain();
            output.gain.value = 0.8;
            output.connect(context.destination);
            noise = createNoise();
            loadRecorded();
        }

        if (context.state === "suspended") {
            context.resume();
        }
    }

    async function loadRecorded() {
        const buffers = await Promise.all(files.map(async (url) => {
            try {
                const response = await fetch(url);
                return await context.decodeAudioData(await response.arrayBuffer());
            } catch {
                return null;
            }
        }));

        recorded = buffers.filter(Boolean);
    }

    // sound är "bark", "yip", "growl", "howl" eller "whine"
    function play(sound, { loud = false } = {}) {
        if (muted || !context) {
            return;
        }

        const time = context.currentTime;

        if (sound === "bark" && recorded.length > 0) {
            playRecorded(time, loud);
        } else if (sound === "yip") {
            bark(time, loud, 1.6);
        } else if (sound === "growl") {
            growl(time, loud);
        } else if (sound === "howl") {
            howl(time);
        } else if (sound === "whine") {
            whine(time);
        } else {
            bark(time, loud, 1);
        }
    }

    function playRecorded(time, loud) {
        const source = context.createBufferSource();
        source.buffer = recorded[Math.floor(Math.random() * recorded.length)];
        source.playbackRate.value = 0.95 + Math.random() * 0.1;

        const volume = context.createGain();
        volume.gain.value = loud ? 1 : 0.75;

        source.connect(volume).connect(output);
        source.start(time);
    }

    // Ett kort "voff". pitch över 1 ger ett ljusare "wiff".
    function bark(time, loud, pitch) {
        const length = (loud ? 0.26 : 0.2) / Math.sqrt(pitch);
        const tone = (0.9 + Math.random() * 0.2) * pitch;

        // Rösten stiger och sjunker snabbt, som i "vo-off"
        const voice = context.createOscillator();
        voice.type = "sawtooth";
        voice.frequency.setValueAtTime(280 * tone, time);
        voice.frequency.exponentialRampToValueAtTime(460 * tone, time + 0.04);
        voice.frequency.exponentialRampToValueAtTime(170 * tone, time + length);

        // Filtret öppnas och stängs som en mun
        const mouth = context.createBiquadFilter();
        mouth.type = "lowpass";
        mouth.Q.value = 6;
        mouth.frequency.setValueAtTime(700, time);
        mouth.frequency.exponentialRampToValueAtTime(2200 * pitch, time + 0.04);
        mouth.frequency.exponentialRampToValueAtTime(500, time + length);

        voice.connect(mouth);
        breath(time, length, 1400, 0.25).connect(mouth);
        mouth.connect(envelope(time, { attack: 0.012, length, release: length - 0.012, peak: loud ? 0.9 : 0.6 }));

        voice.start(time);
        voice.stop(time + length + 0.05);
    }

    function growl(time, loud) {
        const length = 0.8;

        const voice = context.createOscillator();
        voice.type = "sawtooth";
        voice.frequency.setValueAtTime(85 + Math.random() * 15, time);

        // Volymen darrar snabbt, och det är det som gör att det låter som ett morrande
        const rumble = context.createGain();
        rumble.gain.value = 0.5;

        const shake = context.createOscillator();
        shake.frequency.value = 28;

        const shakeDepth = context.createGain();
        shakeDepth.gain.value = 0.5;
        shake.connect(shakeDepth).connect(rumble.gain);

        const throat = context.createBiquadFilter();
        throat.type = "lowpass";
        throat.frequency.value = 600;
        throat.Q.value = 3;

        voice.connect(rumble);
        breath(time, length, 400, 0.3).connect(rumble);
        rumble.connect(throat).connect(envelope(time, { attack: 0.08, length, release: 0.25, peak: loud ? 0.9 : 0.7 }));

        voice.start(time);
        shake.start(time);
        voice.stop(time + length);
        shake.stop(time + length);
    }

    function howl(time) {
        const length = 1.4;

        const voice = context.createOscillator();
        voice.type = "triangle";
        voice.frequency.setValueAtTime(380, time);
        voice.frequency.linearRampToValueAtTime(640, time + 0.35);
        voice.frequency.linearRampToValueAtTime(560, time + 1);
        voice.frequency.linearRampToValueAtTime(420, time + length);

        voice.connect(envelope(time, { attack: 0.2, length, release: 0.4, peak: 0.5 }));
        vibrato(time, length, 5.5, 10).connect(voice.frequency);

        voice.start(time);
        voice.stop(time + length);
    }

    function whine(time) {
        const length = 0.7;

        const voice = context.createOscillator();
        voice.type = "sine";
        voice.frequency.setValueAtTime(900, time);
        voice.frequency.linearRampToValueAtTime(1250, time + 0.25);
        voice.frequency.linearRampToValueAtTime(950, time + length);

        voice.connect(envelope(time, { attack: 0.05, length, release: 0.3, peak: 0.25 }));
        vibrato(time, length, 9, 25).connect(voice.frequency);

        voice.start(time);
        voice.stop(time + length);
    }

    // Hur ljudet tonar in och ut. Kopplas direkt till högtalaren.
    function envelope(time, { attack, length, release, peak }) {
        const gain = context.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.exponentialRampToValueAtTime(peak, time + attack);
        gain.gain.setValueAtTime(peak, time + length - release);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
        gain.connect(output);

        return gain;
    }

    // Brus, som andningen i ett skall
    function breath(time, length, frequency, level) {
        const source = context.createBufferSource();
        source.buffer = noise;

        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = frequency;
        filter.Q.value = 0.8;

        const gain = context.createGain();
        gain.gain.value = level;

        source.connect(filter).connect(gain);
        source.start(time);
        source.stop(time + length);

        return gain;
    }

    // Får tonen att darra lite, som en riktig röst
    function vibrato(time, length, speed, depth) {
        const wobble = context.createOscillator();
        wobble.frequency.value = speed;

        const amount = context.createGain();
        amount.gain.value = depth;

        wobble.connect(amount);
        wobble.start(time);
        wobble.stop(time + length);

        return amount;
    }

    function createNoise() {
        const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < data.length; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        return buffer;
    }

    function readMuted() {
        try {
            return localStorage.getItem(STORAGE_KEY) === "ja";
        } catch {
            return false;
        }
    }

    function setMuted(value) {
        muted = value;

        try {
            localStorage.setItem(STORAGE_KEY, value ? "ja" : "nej");
        } catch {
            // Utan localStorage gäller valet bara tills sidan laddas om
        }
    }

    return {
        unlock,
        play,
        setMuted,
        isMuted: () => muted
    };
}
