// ---- 10 synthesized "mandala" bell tones (Tibetan-bowl style, no audio files) ----
const SOUNDS = [
    { name: "Basu",    desc: "Root · 432 Hz",       base: 432, dur: 4.5, partials: [{r:1,g:1.0},{r:2.76,g:0.45},{r:5.40,g:0.18}] },
    { name: "Ombu",    desc: "Heart · 528 Hz",      base: 528, dur: 4.5, partials: [{r:1,g:1.0},{r:2.70,g:0.40},{r:4.10,g:0.15}] },
    { name: "Tingsha", desc: "Connection · 639 Hz", base: 639, dur: 3.8, partials: [{r:1,g:0.9},{r:2.80,g:0.55},{r:6.20,g:0.25}] },
    { name: "Koshi",   desc: "Awakening · 396 Hz",  base: 396, dur: 5.0, partials: [{r:1,g:1.0},{r:2.66,g:0.42},{r:3.98,g:0.20}] },
    { name: "Lotus",   desc: "Foundation · 285 Hz", base: 285, dur: 5.5, partials: [{r:1,g:1.0},{r:2.40,g:0.38},{r:5.10,g:0.14}] },
    { name: "Prana",   desc: "Grounding · 174 Hz",  base: 174, dur: 6.0, partials: [{r:1,g:1.0},{r:2.20,g:0.35},{r:4.40,g:0.16}] },
    { name: "Zenith",  desc: "Balance · 480 Hz",    base: 480, dur: 4.2, partials: [{r:1,g:1.0},{r:2.76,g:0.50},{r:5.00,g:0.20}] },
];

// ---- SVG geometry (viewBox 230, center 115, r 100) ----
const CX = 115, CY = 115, R = 100, CIRC = 2 * Math.PI * R; // 628.3

// starter presets used on first run / when stored data is unreadable
const DEFAULT_PRESETS = [
    { name: "Morning Practice", duration: 12, intervals: [] },
    { name: "Deep Focus",       duration: 21, intervals: [20] }
];

// safe JSON read: never let a corrupt localStorage value throw at load time
function readJSON(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v == null ? fallback : v;
    } catch (e) { return fallback; }
}

const app = {
    MAX_MIN: 60,     // one full turn of the dial = 60 minutes
    MAX_TOTAL: 1440, // dial can wind up to 24 hours over multiple turns
    _editingPreset: null,
    _setupUnit: 'min', // which unit the Set Time / Edit page is currently using
    state: {
        durationSeconds: 0,
        remainingSeconds: 0,
        intervalMarks: [],        // elapsed-seconds at which to ring
        presetName: "Meditation",
        isRunning: false,
        timerId: null,
        wakeLock: null,
        soundIndex: parseInt(localStorage.getItem('mandalaSound'), 10) || 0,
        // how the alarm shares the phone's audio while music plays:
        //   'ambient'  = mix WITH music so it keeps playing, obeys the silent switch (default)
        //   'playback' = play OVER music (interrupts it), ignores the silent switch
        audioMode: (localStorage.getItem('mandalaAudioMode') === 'playback') ? 'playback' : 'ambient',
        presets: readJSON('smartAlarmPresets', DEFAULT_PRESETS)
    },

    // lazily created on first user gesture (avoids autoplay-policy console warnings)
    audioCtx: null,
    _ctxType: null,   // the navigator.audioSession.type the current context was built under
    _ctx() {
        if (!this.audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.audioCtx = new AC();
        }
        // another app grabbing the audio session (e.g. music starting) can suspend us;
        // always try to resume before we schedule a sound.
        if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
        return this.audioCtx;
    },

    // Ensure the AudioContext is running under the desired iOS audio-session category.
    // iOS locks the category in at context-creation time, so if it changed we must
    // rebuild the context AFTER setting the type — otherwise 'playback' silently has
    // no effect and other apps' music (Apple Music) ducks our alarm to nothing.
    _ensureAudioSession(type) {
        const want = type || 'playback';
        try {
            if (navigator.audioSession && this.audioCtx && this._ctxType !== want) {
                try { this.audioCtx.close(); } catch (_) {}
                this.audioCtx = null;
                this._ka = null;   // its source belonged to the closed context
            }
        } catch (_) {}
        try { if (navigator.audioSession) navigator.audioSession.type = want; } catch (_) {}
        const ctx = this._ctx();   // (re)creates under the type just set
        this._ctxType = want;
        if (ctx && ctx.state === 'suspended') ctx.resume();
        return ctx;
    },

    init() {
        if (!Array.isArray(this.state.presets)) this.state.presets = DEFAULT_PRESETS.slice();
        if (!Number.isFinite(this.state.soundIndex) || this.state.soundIndex >= SOUNDS.length) this.state.soundIndex = 0;
        this.updateDisplay();
        this.renderPresets();
        this.renderSounds();
        this.initDial();
        document.addEventListener('visibilitychange', () => {
            if (this.state.isRunning && document.visibilityState === 'visible') this.requestWakeLock();
            // another app taking audio focus (music) can push our context to
            // 'interrupted'/'suspended' and freeze its clock; wake it back up.
            if (document.visibilityState === 'visible' && this.audioCtx && this.audioCtx.state !== 'running') {
                this.audioCtx.resume().catch(() => {});
            }
        });
    },

    // ---- Navigation ----
    switchView(id) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },
    showTimer()   { if (pomodoro.state.isRunning) pomodoro.pause(); if (timebox.state.isRunning) timebox.pause(); this.switchView('view-timer'); this.updateDisplay(); document.title = 'Meditation Timer — lunatimer'; },
    showPresets() { this.renderPresets(); this.switchView('view-presets'); },
    showSettings(){ this.renderSounds(); this.renderAudioMode(); this.switchView('view-settings'); },

    showTimeSetup() {
        if (this.state.isRunning) return;
        this._editingPreset = null;
        document.getElementById('view-setup').classList.remove('editing');
        document.getElementById('setup-title').innerText = 'Set Time';
        document.getElementById('setup-btn').innerText = 'Apply';
        // seconds if the duration isn't a whole number of minutes, else minutes
        const secs = this.state.durationSeconds;
        const unit = (secs > 0 && secs % 60 !== 0) ? 'sec' : 'min';
        this._setupUnit = unit;
        const div = unit === 'sec' ? 1 : 60;
        document.getElementById('input-duration').value = secs ? Math.round(secs / div) : '';
        document.getElementById('input-interval').value = this.state.intervalMarks.map(s => s / div).join(', ');
        this._applyUnitUI();
        this.switchView('view-setup');
    },

    // switch the setup form between minutes and seconds, converting typed values
    setUnit(unit) {
        if (unit === this._setupUnit) return;
        const durEl = document.getElementById('input-duration');
        const intEl = document.getElementById('input-interval');
        const factor = unit === 'sec' ? 60 : (1 / 60); // min->sec multiplies by 60; sec->min divides
        const conv = (v) => {
            const n = parseFloat(v);
            if (!Number.isFinite(n)) return '';
            const r = n * factor;
            return unit === 'sec' ? Math.round(r) : +r.toFixed(2);
        };
        const dv = parseFloat(durEl.value);
        durEl.value = Number.isFinite(dv) ? conv(dv) : '';
        intEl.value = (intEl.value || '')
            .split(/[,\s]+/).map(x => x.trim()).filter(Boolean)
            .map(conv).filter(x => x !== '').join(', ');
        this._setupUnit = unit;
        this._applyUnitUI();
    },

    _applyUnitUI() {
        const unit = this._setupUnit;
        const word = unit === 'sec' ? 'seconds' : 'minutes';
        document.getElementById('label-duration').innerText = `Duration (${word})`;
        document.getElementById('label-interval').innerText = `Interval bells (${word}, comma-separated)`;
        document.querySelectorAll('#unit-toggle .unit-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.unit === unit);
        });
    },

    resetToTimer() {
        // re-arm to the full set duration; if running, restart the countdown from full
        this.state.remainingSeconds = this.state.durationSeconds;
        if (this.state.isRunning) {
            this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;
            this._firedMarks = new Set();
        }
        this.showTimer();
    },

    // Cancel: stop the timer and clear it back to zero
    cancel() {
        if (this.state.isRunning) this.pauseTimer();
        this.state.durationSeconds = 0;
        this.state.remainingSeconds = 0;
        this.state.intervalMarks = [];
        this.state.presetName = 'Meditation';
        this.updateDisplay();
    },

    // ---- Timer-type chooser (Meditation vs Pomodoro vs Timebox) ----
    chooseMode() {
        const ov = document.getElementById('chooser-overlay');
        ov.classList.add('open');
        ov.onclick = (e) => { if (e.target === ov) this.closeChooser(); };
    },
    closeChooser() { document.getElementById('chooser-overlay').classList.remove('open'); },
    pickMeditation() { this.goMode('meditation'); },
    pickPomodoro()   { this.goMode('pomodoro'); },
    pickTimebox()    { this.goMode('timebox'); },

    // ---- Routing: /timer, /pomodoro, /timebox map to the three timers ----
    _pathForMode(mode) {
        return mode === 'pomodoro' ? '/pomodoro'
             : mode === 'timebox'  ? '/timebox'
             : mode === 'meditation' ? '/timer'
             : '/welcome'; // welcome = choose-a-timer hub
    },
    _modeForPath(pathname) {
        const p = (pathname || '/welcome').replace(/\/+$/, '') || '/welcome';
        if (p === '/timer') return 'meditation';
        if (p === '/pomodoro') return 'pomodoro';
        if (p === '/timebox') return 'timebox';
        return 'welcome'; // /welcome (and anything else) opens the chooser
    },
    // keep <link rel="canonical"> in sync with the current route
    _setCanonical(path) {
        const el = document.querySelector('link[rel="canonical"]');
        if (el) el.setAttribute('href', 'https://lunatimer.app' + path);
    },
    // open the given timer's view (no history change)
    _openMode(mode) {
        this.closeChooser();
        if (mode === 'pomodoro') {
            if (this.state.isRunning) this.pauseTimer();
            if (timebox.state.isRunning) timebox.pause();
            pomodoro.open();
        } else if (mode === 'timebox') {
            if (this.state.isRunning) this.pauseTimer();
            if (pomodoro.state.isRunning) pomodoro.pause();
            timebox.open();
        } else if (mode === 'meditation') {
            if (pomodoro.state.isRunning) pomodoro.pause();
            if (timebox.state.isRunning) timebox.pause();
            this.showTimer();
        } else {
            // choose-a-timer hub (welcome)
            if (this.state.isRunning) this.pauseTimer();
            if (pomodoro.state.isRunning) pomodoro.pause();
            if (timebox.state.isRunning) timebox.pause();
            this.switchView('view-welcome');
            document.title = 'lunatimer — Choose your timer';
        }
        this._setCanonical(this._pathForMode(mode));
        this._mode = mode;
    },
    // send the user back to the welcome (choose-a-timer) screen
    goHome() { this.goMode('welcome'); },
    // switch timer AND push a new URL (used by the chooser)
    goMode(mode) {
        this._openMode(mode);
        const path = this._pathForMode(mode);
        if (location.pathname !== path) history.pushState({ mode }, '', path);
    },
    // called once on load: open the view for the current URL + handle back/forward
    initRouter() {
        const mode = this._modeForPath(location.pathname);
        history.replaceState({ mode }, '', this._pathForMode(mode)); // normalise '/' -> '/timer'
        this._openMode(mode);
        window.addEventListener('popstate', () => this._openMode(this._modeForPath(location.pathname)));
    },

    // ---- Timer ----
    toggleTimer() {
        if (this.state.isRunning) this.pauseTimer();
        else this.startTimer();
    },

    startTimer() {
        // nothing set yet — send the user to Set Time instead of silently doing nothing
        if (this.state.remainingSeconds <= 0) { this.showTimeSetup(); return; }
        // grab the audio session under the chosen category BEFORE scheduling, so the
        // alarm actually sounds over Apple Music (iOS only honours the category at
        // context-creation time).
        const ctx = this._ensureAudioSession(this.state.audioMode);
        this.state.isRunning = true;
        document.getElementById('app').classList.add('running');
        this.setPlayButton(true);
        this.requestWakeLock();

        // wall-clock end time drives a smooth, accurate ring (Apple-style)
        this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;
        this._firedMarks = new Set();

        // look-ahead audio: schedule interval bells + final alarm on the Web Audio
        // clock so they still sound if JS timers are throttled in the background.
        this._scheduleBells(ctx);
        this._keepAliveOn();
        this._mediaOn('Meditation', this.state.presetName || 'Timer');
        // prime a media-element copy of the final bell (rings even over other apps'
        // music when the timer ends while on screen)
        this.prepareAlarmClip({ kind: 'bowl', def: this.currentSound() });
        this.typeAlarmTip();

        this.state.timerId = setInterval(() => {
            const remMs = this.state.endTime - performance.now();
            this.state.remainingSeconds = Math.max(0, Math.ceil(remMs / 1000));

            if (remMs <= 0) {
                // Foreground: ring the bell LIVE (reliable & audible over other apps'
                // music). Background: trust the pre-scheduled bell on the audio clock.
                if (document.visibilityState === 'visible') {
                    this._clearScheduleAll();       // drop the pre-scheduled final so we don't double-ring
                    this.pauseTimer();
                    // primed media element first (audible over music, no gesture needed);
                    // fall back to a live Web Audio ring if the clip isn't ready.
                    if (!this.playAlarmClip()) this._ringNowBowl(this.currentSound(), {});
                } else {
                    this.pauseTimer();
                }
                this.switchView('view-complete');
            } else {
                this.updateDisplay();
            }
        }, 250);

        this.updateDisplay();
        this._raf();
    },

    // schedule this run's interval bells + final alarm on the audio clock
    _scheduleBells(ctx) {
        if (!ctx) return;
        this._clearSchedule();
        const base = ctx.currentTime;
        const elapsed = this.state.durationSeconds - this.state.remainingSeconds;
        const snd = this.currentSound();
        this.state.intervalMarks.forEach((m) => {
            const when = m - elapsed;                                     // seconds from now
            if (when > 0.05) this._bowlAt(snd, base + when, { dur: 1.8, pitch: 1.5 });
        });
        this._bowlAt(snd, base + this.state.remainingSeconds, {});        // final alarm
        this._finalAlarmAt = base + this.state.remainingSeconds;          // to detect a missed (clock-frozen) fire
    },

    // did the pre-scheduled final alarm actually play? (false if the audio clock
    // stalled because another app held the session, so we must ring it live)
    _alarmDidFire() {
        const c = this.audioCtx;
        return !!(c && c.state === 'running' && this._finalAlarmAt != null
            && c.currentTime >= this._finalAlarmAt - 0.05);
    },

    // per-frame paint so the ring/knob glide continuously
    _raf() {
        if (!this.state.isRunning) return;
        const remMs = Math.max(0, this.state.endTime - performance.now());
        const frac = this.state.durationSeconds ? (remMs / 1000) / this.state.durationSeconds : 0;
        this.paintProgress(frac);
        this._rafId = requestAnimationFrame(() => this._raf());
    },

    pauseTimer() {
        if (this.state.endTime) {
            this.state.remainingSeconds = Math.max(0, Math.ceil((this.state.endTime - performance.now()) / 1000));
        }
        this.state.isRunning = false;
        clearInterval(this.state.timerId);
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._stopTimerAudio();
        document.getElementById('app').classList.remove('running');
        this.setPlayButton(false);
        this.releaseWakeLock();
        this.clearAlarmTip();
        this.updateDisplay();
    },

    setPlayButton(running) {
        document.getElementById('play-label').innerText = running ? 'Pause' : 'Start';
    },

    // Type out a gentle reminder (like someone writing a message) when a run starts.
    typeAlarmTip() {
        const el = document.getElementById('alarm-tip');
        if (!el) return;
        const msg = 'Turn off silent mode to hear the bell.';
        clearInterval(this._tipTimer);
        el.textContent = '';
        el.classList.add('typing');
        let i = 0;
        this._tipTimer = setInterval(() => {
            el.textContent = msg.slice(0, ++i);
            if (i >= msg.length) {
                clearInterval(this._tipTimer);
                el.classList.remove('typing');
            }
        }, 40);
    },
    clearAlarmTip() {
        clearInterval(this._tipTimer);
        const el = document.getElementById('alarm-tip');
        if (el) { el.textContent = ''; el.classList.remove('typing'); }
    },

    bellsRemaining() {
        const elapsed = this.state.durationSeconds - this.state.remainingSeconds;
        const upcoming = this.state.intervalMarks.filter(m => m > elapsed).length;
        return upcoming + 1; // + final alarm
    },

    // MM:SS, or H:MM:SS past an hour
    clock(totalSec) {
        const s = Math.max(0, Math.round(totalSec));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const mm = m.toString().padStart(2, '0'), ss = sec.toString().padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    },

    updateDisplay() {
        const running = this.state.isRunning;
        document.getElementById('preset-name').innerText = this.state.presetName || 'Meditation';

        const timeEl = document.getElementById('time-text');
        const hintEl = document.getElementById('hint');

        if (running) {
            timeEl.innerText = this.clock(this.state.remainingSeconds);
            const n = this.bellsRemaining();
            hintEl.innerText = `${n} bell${n > 1 ? 's' : ''} left`;
            // the ring/knob are painted every frame by _raf()
        } else {
            timeEl.innerText = this.clock(this.state.durationSeconds);
            hintEl.innerText = this.state.durationSeconds > 0 ? 'tap to edit' : 'type to edit';
            const durMin = Math.round(this.state.durationSeconds / 60);
            const lap = durMin % 60;
            const frac = (lap === 0 && durMin > 0) ? 1 : lap / 60; // one full circle per 60 min
            this.paintProgress(frac);
        }
        // shrink the numbers as the string grows (MM:SS vs H:MM:SS / HH:MM:SS)
        timeEl.classList.toggle('t-long', timeEl.innerText.length >= 7);
        timeEl.classList.toggle('t-xlong', timeEl.innerText.length >= 8);
    },

    // draw the arc + traveling knob for a given remaining-fraction (0..1)
    paintProgress(frac) {
        document.getElementById('progress-arc').style.strokeDashoffset = CIRC * (1 - frac);
        const headDeg = -90 + frac * 360;
        const rad = headDeg * Math.PI / 180;
        const hx = CX + R * Math.cos(rad);
        const hy = CY + R * Math.sin(rad);
        const knob = document.getElementById('progress-knob');
        knob.setAttribute('cx', hx.toFixed(2));
        knob.setAttribute('cy', hy.toFixed(2));
    },

    // ---- Finger dial: drag around the ring; each full circle = 60 min ----
    initDial() {
        const c = document.getElementById('timer-container');
        let active = false, moved = false, sx = 0, sy = 0;

        c.addEventListener('pointerdown', (e) => {
            if (this.state.isRunning) return;
            active = true; moved = false; sx = e.clientX; sy = e.clientY;
            const curMin = Math.round(this.state.durationSeconds / 60);
            this._accDeg = (curMin / 60) * 360;                  // angle that represents current minutes
            this._prevAng = this._angleFromTop(e.clientX, e.clientY);
        });
        window.addEventListener('pointermove', (e) => {
            if (!active) return;
            if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
            moved = true;
            this.setDurationFromPointer(e.clientX, e.clientY);
            e.preventDefault();
        });
        window.addEventListener('pointerup', () => {
            if (!active) return;
            active = false;
            if (!moved) this.showTimeSetup(); // a tap opens manual / interval-bell setup
        });
    },

    _angleFromTop(clientX, clientY) {
        const svg = document.querySelector('.timer-svg');
        const r = svg.getBoundingClientRect();
        const scale = 230 / r.width;
        const dx = (clientX - r.left) * scale - CX;
        const dy = (clientY - r.top) * scale - CY;
        const ang = Math.atan2(dy, dx) * 180 / Math.PI; // 0 at 3 o'clock
        return (ang + 90 + 360) % 360;                  // 0 at top, clockwise
    },

    setDurationFromPointer(clientX, clientY) {
        // accumulate the finger's own angular movement (relative drag) — no wrap guessing
        const cur = this._angleFromTop(clientX, clientY);
        let d = cur - this._prevAng;
        if (d > 180) d -= 360;        // finger took the short way across the top
        else if (d < -180) d += 360;
        this._prevAng = cur;

        this._accDeg += d;
        const maxDeg = (this.MAX_TOTAL / 60) * 360;
        this._accDeg = Math.max(0, Math.min(maxDeg, this._accDeg));

        const mins = Math.max(1, Math.min(this.MAX_TOTAL, Math.round(this._accDeg / 360 * 60)));

        this.state.durationSeconds = mins * 60;
        this.state.remainingSeconds = mins * 60;
        this.state.intervalMarks = this.state.intervalMarks.filter(m => m < mins * 60);
        this.state.presetName = 'Meditation';
        this.updateDisplay();

        // smooth ring: follow the finger's continuous angle instead of the snapped
        // minute value, so the arc/knob glide rather than jump step-by-step
        let frac = (this._accDeg % 360) / 360;
        if (frac === 0 && this._accDeg > 0) frac = 1;
        this.paintProgress(frac);
    },

    // convert a value in the given unit to seconds
    toSec(n, unit) { return unit === 'sec' ? n : n * 60; },

    // read a preset's duration + interval marks in SECONDS (handles old min-based presets)
    presetSecs(p) {
        const durSec = (p.durationSec != null) ? p.durationSec : Math.round((p.duration || 0) * 60);
        const src = (p.intervalsSec != null) ? p.intervalsSec : (p.intervals || []).map(m => Math.round(m * 60));
        return { durSec, intSec: src };
    },

    // human label for a duration in seconds (e.g. "90 sec", "12 min", "1 h 5 min")
    fmtDur(sec) {
        if (sec % 60 !== 0) return `${sec} sec`;
        const m = sec / 60;
        if (m < 60) return `${m} min`;
        const h = Math.floor(m / 60), rem = m % 60;
        return rem ? `${h} h ${rem} min` : `${h} h`;
    },

    parseIntervals(str, maxSec, unit) {
        return (str || '')
            .split(/[,\s]+/)
            .map(x => parseFloat(x.trim()))
            .filter(n => n > 0)
            .map(n => Math.round(this.toSec(n, unit)))
            .filter(s => s > 0 && s < maxSec)
            .sort((a, b) => a - b);
    },

    // ---- Set Time (apply to timer) OR save an edited preset ----
    saveSetup() {
        const unit = this._setupUnit;
        const durNum = parseFloat(document.getElementById('input-duration').value);
        const intervalStr = document.getElementById('input-interval').value;
        const durSec = (durNum > 0) ? Math.round(this.toSec(durNum, unit)) : 0;

        if (this._editingPreset !== null) {
            // editing an existing preset
            const p = this.state.presets[this._editingPreset];
            if (p) {
                const name = document.getElementById('input-name').value.trim();
                if (name) p.name = name;
                if (durSec > 0) {
                    p.durationSec = durSec;
                    p.intervalsSec = this.parseIntervals(intervalStr, durSec, unit);
                    delete p.duration; delete p.intervals; // migrate off the old min-based fields
                }
                localStorage.setItem('smartAlarmPresets', JSON.stringify(this.state.presets));
            }
            this._editingPreset = null;
            document.getElementById('view-setup').classList.remove('editing');
            this.renderPresets();
            this.switchView('view-presets');
            return;
        }

        // applying to the live timer
        if (durSec > 0) {
            if (this.state.isRunning) this.pauseTimer();
            this.state.durationSeconds = durSec;
            this.state.remainingSeconds = durSec;
            this.state.intervalMarks = this.parseIntervals(intervalStr, durSec, unit);
            this.state.presetName = 'Meditation';
        }
        this.showTimer();
    },

    // save the values currently typed on the Set Time page as a new preset
    async saveSetupAsPreset() {
        const unit = this._setupUnit;
        const durNum = parseFloat(document.getElementById('input-duration').value);
        const intervalStr = document.getElementById('input-interval').value;
        const durSec = (durNum > 0) ? Math.round(this.toSec(durNum, unit)) : 0;
        if (!(durSec > 0)) { await this.alertDialog('Enter a duration first.'); return; }
        const name = await this.promptDialog('Preset name', '', 'Save Preset');
        if (!name) return;
        this.state.presets.push({
            name: name,
            durationSec: durSec,
            intervalsSec: this.parseIntervals(intervalStr, durSec, unit)
        });
        localStorage.setItem('smartAlarmPresets', JSON.stringify(this.state.presets));
        this.renderPresets();
        this.switchView('view-presets');
    },

    // ---- Presets ----
    renderPresets() {
        const list = document.getElementById('presets-list');
        list.innerHTML = '';
        this.state.presets.forEach((p, i) => {
            const { durSec, intSec } = this.presetSecs(p);
            const bells = intSec.map(s => this.fmtDur(s)).join(', ');
            const div = document.createElement('div');
            div.className = 'preset-item';
            div.innerHTML = `
                <div class="p-body">
                    <div class="p-name"></div>
                    <div class="p-sub">${this.fmtDur(durSec)}${intSec.length ? ' &bull; bells: ' + bells : ''}</div>
                </div>
                <div class="p-actions">
                    <button class="p-btn" data-act="edit">Edit</button>
                    <button class="p-btn danger" data-act="del">Delete</button>
                </div>`;
            div.querySelector('.p-name').textContent = p.name;
            // tapping the body loads the preset into the timer
            div.querySelector('.p-body').onclick = () => this.loadPreset(i);
            div.querySelector('[data-act="edit"]').onclick = (e) => { e.stopPropagation(); this.editPreset(i); };
            div.querySelector('[data-act="del"]').onclick = (e) => { e.stopPropagation(); this.deletePreset(i); };
            list.appendChild(div);
        });
    },

    loadPreset(i) {
        const p = this.state.presets[i];
        if (!p) return;
        if (this.state.isRunning) this.pauseTimer();
        const { durSec, intSec } = this.presetSecs(p);
        this.state.durationSeconds = durSec;
        this.state.remainingSeconds = durSec;
        this.state.intervalMarks = intSec.slice();
        this.state.presetName = p.name;
        this.showTimer();
    },

    editPreset(i) {
        const p = this.state.presets[i];
        if (!p) return;
        this._editingPreset = i;
        document.getElementById('setup-title').innerText = 'Edit Preset';
        document.getElementById('setup-btn').innerText = 'Save';
        document.getElementById('view-setup').classList.add('editing');
        const { durSec, intSec } = this.presetSecs(p);
        // show in seconds when it isn't a whole number of minutes
        const unit = (durSec % 60 !== 0) ? 'sec' : 'min';
        this._setupUnit = unit;
        const div = unit === 'sec' ? 1 : 60;
        document.getElementById('input-name').value = p.name;
        document.getElementById('input-duration').value = Math.round(durSec / div);
        document.getElementById('input-interval').value = intSec.map(s => s / div).join(', ');
        this._applyUnitUI();
        this.switchView('view-setup');
    },

    async deletePreset(i) {
        const p = this.state.presets[i];
        if (!p) return;
        const ok = await this.confirmDialog(`Delete preset "${p.name}"?`, 'Delete Preset');
        if (!ok) return;
        this.state.presets.splice(i, 1);
        localStorage.setItem('smartAlarmPresets', JSON.stringify(this.state.presets));
        this.renderPresets();
    },

    async addPreset() {
        const name = await this.promptDialog('Preset name', '', 'Add Preset');
        if (!name) return;
        this.state.presets.push({
            name: name,
            durationSec: this.state.durationSeconds,
            intervalsSec: this.state.intervalMarks.slice()
        });
        localStorage.setItem('smartAlarmPresets', JSON.stringify(this.state.presets));
        this.renderPresets();
    },

    // ---- Settings / sounds ----
    currentSound() { return SOUNDS[this.state.soundIndex] || SOUNDS[0]; },

    renderSounds() {
        const list = document.getElementById('sounds-list');
        list.innerHTML = '';
        SOUNDS.forEach((snd, i) => {
            const div = document.createElement('div');
            div.className = 'sound-item' + (i === this.state.soundIndex ? ' selected' : '');
            div.innerHTML = `
                <div>
                    <div class="s-name">${snd.name}</div>
                    <div class="s-sub">${snd.desc}</div>
                </div>
                <div class="s-check">&#10003;</div>`;
            div.onclick = () => {
                this.state.soundIndex = i;
                localStorage.setItem('mandalaSound', i);
                this.renderSounds();
                const ctx = this._ctx();
                if (ctx && ctx.state === 'suspended') ctx.resume();
                this.playSound(snd, { dur: 2.6 }); // preview
            };
            list.appendChild(div);
        });
    },

    // choose how the alarm shares audio with other apps' music (meditation only)
    setAudioMode(mode) {
        this.state.audioMode = (mode === 'ambient') ? 'ambient' : 'playback';
        localStorage.setItem('mandalaAudioMode', this.state.audioMode);
        this.renderAudioMode();
        // if a meditation timer is already running, rebuild the session under the new
        // category and re-arm the scheduled bells (iOS only honours the category when
        // the context is created, so a live swap needs a fresh context).
        if (this.state.isRunning) {
            const ctx = this._ensureAudioSession(this.state.audioMode);
            this._scheduleBells(ctx);
            this._keepAliveOn();
        }
    },
    renderAudioMode() {
        const pb = document.getElementById('mode-playback');
        const am = document.getElementById('mode-ambient');
        const hint = document.getElementById('sound-mode-hint');
        if (!pb || !am) return;
        const over = this.state.audioMode !== 'ambient';
        pb.classList.toggle('active', over);
        am.classList.toggle('active', !over);
        pb.setAttribute('aria-pressed', String(over));
        am.setAttribute('aria-pressed', String(!over));
        if (hint) hint.innerText = over
            ? 'Alarm plays over other music and rings even when the phone is on silent.'
            : 'Alarm mixes with your music, but stays silent when the phone’s mute switch is on.';
    },
    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            if (this.state.wakeLock) return;         // already held
            try {
                const lock = await navigator.wakeLock.request('screen');
                this.state.wakeLock = lock;
                // the OS auto-releases when the tab is hidden — re-acquire if still running
                lock.addEventListener('release', () => {
                    this.state.wakeLock = null;
                    if (this.state.isRunning && document.visibilityState === 'visible') {
                        this.requestWakeLock();
                    }
                });
            } catch (err) { /* denied / not visible — will retry on visibility change */ }
        } else {
            this.startNoSleepVideo();                // fallback for older iOS / Safari
        }
    },
    async releaseWakeLock() {
        if (this.state.wakeLock) {
            try { await this.state.wakeLock.release(); } catch (err) { /* ignore */ }
            this.state.wakeLock = null;
        }
        this.stopNoSleepVideo();
    },

    // Fallback: a looping muted inline video keeps the display awake where Wake Lock is missing
    startNoSleepVideo() {
        let v = this._noSleepVideo;
        if (!v) {
            v = document.createElement('video');
            v.setAttribute('muted', '');
            v.setAttribute('playsinline', '');
            v.muted = true;
            v.loop = true;
            v.width = 1; v.height = 1;
            v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0;';
            // tiny generated stream so no binary asset needs to ship
            try {
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = 2;
                const stream = canvas.captureStream ? canvas.captureStream(1) : null;
                if (stream) v.srcObject = stream;
            } catch (err) { /* ignore */ }
            document.body.appendChild(v);
            this._noSleepVideo = v;
        }
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
    },
    stopNoSleepVideo() {
        if (this._noSleepVideo) { try { this._noSleepVideo.pause(); } catch (err) {} }
    },

    // ---- Custom modal (styled prompt / confirm / alert) ----
    _modal({ title = '', message = '', input = false, value = '', placeholder = '', okText = 'OK', cancelText = 'Cancel', showCancel = true, danger = false }) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('modal-overlay');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const inputEl = document.getElementById('modal-input');
            const okBtn = document.getElementById('modal-ok');
            const cancelBtn = document.getElementById('modal-cancel');

            titleEl.innerText = title;
            msgEl.innerText = message;
            okBtn.innerText = okText;
            cancelBtn.innerText = cancelText;
            okBtn.classList.toggle('danger', danger);
            cancelBtn.classList.toggle('hidden', !showCancel);

            if (input) {
                inputEl.classList.remove('hidden');
                inputEl.value = value;
                inputEl.placeholder = placeholder;
            } else {
                inputEl.classList.add('hidden');
            }

            const prevFocus = document.activeElement;
            const close = (result) => {
                overlay.classList.remove('open');
                okBtn.onclick = cancelBtn.onclick = overlay.onclick = inputEl.onkeydown = overlay.onkeydown = null;
                if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
                resolve(result);
            };

            okBtn.onclick = () => close(input ? inputEl.value.trim() : true);
            cancelBtn.onclick = () => close(input ? null : false);
            overlay.onclick = (e) => { if (e.target === overlay) close(input ? null : false); };
            inputEl.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); okBtn.onclick(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelBtn.onclick(); }
            };
            // Esc anywhere closes; Tab is trapped within the dialog's focusables
            overlay.onkeydown = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); (showCancel ? cancelBtn : okBtn).onclick(); return; }
                if (e.key !== 'Tab') return;
                const f = [inputEl, cancelBtn, okBtn].filter(el => !el.classList.contains('hidden') && el.offsetParent !== null);
                if (!f.length) return;
                const first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            };

            overlay.classList.add('open');
            if (input) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 60);
            else setTimeout(() => okBtn.focus(), 60);
        });
    },
    promptDialog(message, value = '', title = 'Preset') {
        return this._modal({ title, message, input: true, value, placeholder: message });
    },
    confirmDialog(message, title = 'Confirm', danger = true) {
        return this._modal({ title, message, okText: 'Delete', danger });
    },
    alertDialog(message, title = 'Notice') {
        return this._modal({ title, message, showCancel: false });
    },

    // ---- audio scheduling ----
    // Look-ahead: alarms are scheduled directly on the Web Audio clock so they
    // still sound at the right instant even if JS timers are throttled while the
    // tab is backgrounded. A near-silent keep-alive loop + Media Session presence
    // keep the iOS audio session (and this clock) alive in the background.
    _sched: [],   // [{ nodes:[OscillatorNode], at:seconds }] scheduled on the audio clock
    _ka: null,    // silent keep-alive buffer source

    // Tibetan-bowl tone starting at absolute ctx time `at`; registered for cancel.
    _bowlAt(def, at, opts = {}) {
        const ctx = this._ctx();
        if (!ctx) return [];
        const nodes = this._buildBowl(ctx, ctx.destination, def, at, opts);
        this._sched.push({ nodes, at });
        return nodes;
    },

    // build a bowl tone on ANY context/destination (live or offline render)
    _buildBowl(ctx, dest, def, at, opts = {}) {
        const dur = opts.dur || def.dur;
        const pitch = opts.pitch || 1;
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, at);
        master.gain.linearRampToValueAtTime(0.9, at + 0.08);
        master.gain.exponentialRampToValueAtTime(0.0008, at + dur);
        master.connect(dest);
        const nodes = [];
        def.partials.forEach(p => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(def.base * p.r * pitch, at);
            g.gain.setValueAtTime(p.g, at);
            osc.connect(g); g.connect(master);
            osc.start(at); osc.stop(at + dur);
            nodes.push(osc);
        });
        return nodes;
    },

    // Multi-note alarm sequence (pomodoro / timebox) at absolute ctx time `at`.
    _seqAt(alarm, at) {
        const ctx = this._ctx();
        if (!ctx) return [];
        const nodes = this._buildSeq(ctx, ctx.destination, alarm, at);
        this._sched.push({ nodes, at });
        return nodes;
    },

    // build an alarm sequence on ANY context/destination (live or offline render)
    _buildSeq(ctx, dest, alarm, at) {
        const nodes = [];
        alarm.notes.forEach(n => {
            const start = at + n.t;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = alarm.type || 'sine';
            osc.frequency.setValueAtTime(n.f, start);
            g.gain.setValueAtTime(0.0001, start);
            g.gain.linearRampToValueAtTime(n.g, start + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0006, start + n.d);
            osc.connect(g); g.connect(dest);
            osc.start(start); osc.stop(start + n.d);
            nodes.push(osc);
        });
        return nodes;
    },

    // Cancel sounds still comfortably in the future; leave ones already sounding
    // (so a completion bell isn't cut off when the run ends).
    _clearSchedule() {
        const ctx = this.audioCtx;
        const now = ctx ? ctx.currentTime : 0;
        this._sched.forEach(e => {
            if (e.at > now + 0.15) e.nodes.forEach(o => { try { o.stop(); } catch (_) {} });
        });
        this._sched = [];
    },

    // Cancel EVERY pending scheduled sound, including one about to fire — used at
    // completion when we're going to ring the alarm live instead.
    _clearScheduleAll() {
        this._sched.forEach(e => e.nodes.forEach(o => { try { o.stop(); } catch (_) {} }));
        this._sched = [];
    },

    // Ring a bell/sequence live RIGHT NOW, waiting for the context to actually
    // resume first (iOS resume() is async; another app holding audio focus can
    // leave us 'suspended'/'interrupted' with a frozen clock).
    _ringNowBowl(def, opts) {
        const ctx = this._ensureAudioSession(this.state.audioMode);
        if (!ctx) return;
        const go = () => this._bowlAt(def, this.audioCtx.currentTime + 0.04, opts || {});
        (ctx.state === 'running') ? go() : ctx.resume().then(go).catch(go);
    },
    _ringNowSeq(alarm) {
        const ctx = this._ensureAudioSession(this.state.audioMode);
        if (!ctx) return;
        const go = () => this._seqAt(alarm, this.audioCtx.currentTime + 0.04);
        (ctx.state === 'running') ? go() : ctx.resume().then(go).catch(go);
    },

    // ---- primed media-element alarm ----
    // Web Audio can't be resumed from a non-gesture callback while another app
    // (music) owns the audio focus. A <audio> element that was UNLOCKED during the
    // Start tap can, however, be replayed later with no gesture — so we pre-render
    // this run's alarm to a WAV and fire it from the element at 00:00.
    _alarmEl: null,
    _alarmURL: null,     // object URL of the rendered alarm clip (ready to play)
    _silentURL: null,    // tiny silent clip used to unlock the element on a gesture

    _encodeWav(samples, sampleRate) {
        const n = samples.length;
        const buf = new ArrayBuffer(44 + n * 2);
        const v = new DataView(buf);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE');
        w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
        v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
        v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        w(36, 'data'); v.setUint32(40, n * 2, true);
        let o = 44;
        for (let i = 0; i < n; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
        }
        return new Blob([buf], { type: 'audio/wav' });
    },

    // render an alarm descriptor to a WAV blob URL via OfflineAudioContext
    async _renderAlarmURL(desc) {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OAC) return null;
        const sr = 44100;
        let dur = 0.3;
        if (desc.kind === 'bowl') {
            dur = (desc.def.dur || 3) + 0.3;
        } else {
            desc.alarm.notes.forEach(n => { dur = Math.max(dur, n.t + n.d + 0.25); });
        }
        const octx = new OAC(1, Math.max(1, Math.ceil(sr * dur)), sr);
        if (desc.kind === 'bowl') this._buildBowl(octx, octx.destination, desc.def, 0, {});
        else this._buildSeq(octx, octx.destination, desc.alarm, 0);
        const rendered = await octx.startRendering();
        return URL.createObjectURL(this._encodeWav(rendered.getChannelData(0), sr));
    },

    // Called on the Start tap (a user gesture): unlock the element and pre-render
    // this run's alarm clip so it's ready to fire at completion.
    prepareAlarmClip(desc) {
        if (!this._alarmEl) {
            const el = new Audio();
            el.preload = 'auto';
            el.setAttribute('playsinline', '');
            this._alarmEl = el;
        }
        if (!this._silentURL) {
            this._silentURL = URL.createObjectURL(this._encodeWav(new Float32Array(2205), 44100));
        }
        // unlock: playing (silent) content inside the gesture lets us play() later
        try {
            const el = this._alarmEl;
            el.muted = false; el.volume = 1; el.src = this._silentURL;
            const p = el.play();
            if (p && p.then) p.then(() => { try { el.pause(); el.currentTime = 0; } catch (_) {} }).catch(() => {});
        } catch (_) {}
        // render the real clip (async); mark ready when its URL is set
        this._alarmURL = null;
        this._renderAlarmURL(desc)
            .then(url => { if (url) this._alarmURL = url; })
            .catch(() => {});
    },

    // Fire the pre-rendered alarm through the primed element. Returns false if it
    // isn't ready, so callers can fall back to a live Web Audio ring.
    playAlarmClip() {
        const el = this._alarmEl;
        if (!el || !this._alarmURL) return false;
        try {
            el.muted = false; el.volume = 1;
            el.src = this._alarmURL;
            el.currentTime = 0;
            const p = el.play();
            if (p && p.catch) p.catch(() => {});
            return true;
        } catch (_) { return false; }
    },

    // Near-silent looping buffer keeps the iOS audio session (and our clock) alive.
    // The session category ('playback' vs 'ambient') is set by _ensureAudioSession()
    // BEFORE the context is (re)built — that is the only point iOS honours it.
    _keepAliveOn() {
        const ctx = this._ctx();
        if (!ctx || this._ka) return;
        try {
            const buf = ctx.createBuffer(1, Math.max(1, ctx.sampleRate | 0), ctx.sampleRate);
            const src = ctx.createBufferSource();
            src.buffer = buf; src.loop = true;
            const g = ctx.createGain(); g.gain.value = 0.0001;
            src.connect(g); g.connect(ctx.destination);
            src.start();
            this._ka = src;
        } catch (_) {}
    },
    _keepAliveOff() {
        if (this._ka) { try { this._ka.stop(); } catch (_) {} this._ka = null; }
    },

    // Present as active media so iOS is less eager to suspend us in the background.
    _mediaOn(title, sub) {
        if (!('mediaSession' in navigator)) return;
        try {
            if (window.MediaMetadata) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: title || 'lunatimer',
                    artist: sub || 'Timer running',
                    album: 'lunatimer',
                    artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
                });
            }
            navigator.mediaSession.playbackState = 'playing';
            const set = (a, cb) => { try { navigator.mediaSession.setActionHandler(a, cb); } catch (_) {} };
            set('play', () => this._activeResume());
            set('pause', () => this._activePause());
            set('stop', () => this._activePause());
        } catch (_) {}
    },
    _mediaOff() {
        if (!('mediaSession' in navigator)) return;
        try { navigator.mediaSession.playbackState = 'none'; } catch (_) {}
    },

    // Stop all timer-driven audio (future schedule + keep-alive + media presence).
    _stopTimerAudio() { this._clearSchedule(); this._keepAliveOff(); this._mediaOff(); },

    // Route lock-screen / headset controls to whichever timer is open.
    _activePause() {
        if (this._mode === 'pomodoro') pomodoro.pause();
        else if (this._mode === 'timebox') timebox.pause();
        else this.pauseTimer();
    },
    _activeResume() {
        if (this._mode === 'pomodoro') pomodoro.start();
        else if (this._mode === 'timebox') timebox.start();
        else this.startTimer();
    },

    // ---- Synthesized bowl sound (immediate — used for previews) ----
    playSound(def, opts = {}) {
        const ctx = this._ctx();
        if (!ctx) return;
        this._bowlAt(def, ctx.currentTime, opts);
    }
};

app.init();

// =====================================================================
//  POMODORO  — self-contained module sharing app.audioCtx / wake lock
// =====================================================================
const pomodoro = {
    // ordered phase machine: 'work' | 'short' | 'long'
    DEFAULTS: { work: 25, short: 5, long: 15, interval: 4, sound: 0 },

    // 5 distinct completion alarms — each a short synthesized sequence of notes.
    // freq in Hz, t = start offset (s), dur = tone length (s), type = wave, g = gain.
    ALARMS: [
        { name: "Chime",   desc: "Bright rising bell",
          notes: [ {f:660,t:0,d:1.4,g:0.5}, {f:880,t:0.16,d:1.4,g:0.5}, {f:990,t:0.32,d:1.6,g:0.5} ] },
        { name: "Zen",     desc: "Deep singing bowl",  type: "sine",
          notes: [ {f:294,t:0,d:2.6,g:0.55}, {f:441,t:0,d:2.6,g:0.22}, {f:588,t:0.05,d:2.4,g:0.12} ] },
        { name: "Pulse",   desc: "Gentle triple beep", type: "triangle",
          notes: [ {f:784,t:0,d:0.22,g:0.5}, {f:784,t:0.30,d:0.22,g:0.5}, {f:784,t:0.60,d:0.30,g:0.5} ] },
        { name: "Harp",    desc: "Soft arpeggio",      type: "sine",
          notes: [ {f:523,t:0,d:1.1,g:0.45}, {f:659,t:0.12,d:1.1,g:0.45}, {f:784,t:0.24,d:1.1,g:0.45}, {f:1047,t:0.36,d:1.4,g:0.4} ] },
        { name: "Marimba", desc: "Warm wooden tones",  type: "triangle",
          notes: [ {f:587,t:0,d:0.5,g:0.5}, {f:880,t:0.18,d:0.5,g:0.5}, {f:587,t:0.36,d:0.7,g:0.45} ] },
    ],

    state: {
        settings: null,      // {work, short, long, interval, sound} in minutes / index
        mode: 'work',        // current phase
        cycle: 0,            // completed work sessions in the current long-break cycle
        totalDone: 0,        // lifetime completed pomodoros (stats)
        remainingSeconds: 0,
        totalSeconds: 0,
        isRunning: false,
        endTime: 0,          // performance.now() target — drift-corrected
        timerId: null,
        rafId: null,
    },

    // ---- persistence ----
    load() {
        let s = null, stats = null;
        try { s = JSON.parse(localStorage.getItem('pomodoroSettings')); } catch (e) {}
        try { stats = JSON.parse(localStorage.getItem('pomodoroStats')); } catch (e) {}
        this.state.settings = Object.assign({}, this.DEFAULTS, s || {});
        if (!(this.state.settings.sound >= 0 && this.state.settings.sound < this.ALARMS.length)) {
            this.state.settings.sound = 0;
        }
        this.state.totalDone = (stats && stats.totalDone) || 0;
        this.state.cycle = (stats && stats.cycle) || 0;
    },
    saveSettingsStore() {
        localStorage.setItem('pomodoroSettings', JSON.stringify(this.state.settings));
    },
    saveStats() {
        localStorage.setItem('pomodoroStats', JSON.stringify({
            totalDone: this.state.totalDone,
            cycle: this.state.cycle,
        }));
    },

    // ---- durations ----
    modeSeconds(mode) {
        const s = this.state.settings;
        return ({ work: s.work, short: s.short, long: s.long }[mode]) * 60;
    },
    modeLabel(mode) { return { work: 'Focus', short: 'Short Break', long: 'Long Break' }[mode]; },

    // ---- open the screen ----
    open() {
        if (!this.state.settings) this.load();
        // if nothing armed yet, arm the current mode fresh
        if (this.state.totalSeconds === 0) this.arm(this.state.mode);
        app.switchView('view-pomodoro');
        this.render();
    },

    // set up (but don't start) a phase
    arm(mode) {
        this.stopTicking();
        this.state.mode = mode;
        this.state.totalSeconds = this.modeSeconds(mode);
        this.state.remainingSeconds = this.state.totalSeconds;
        this.state.isRunning = false;
        this.setPlayLabel(false);
        document.getElementById('app').classList.remove('running');
        this.render();
    },

    // ---- controls ----
    toggle() { this.state.isRunning ? this.pause() : this.start(); },

    start() {
        // grab the audio session under 'ambient' BEFORE scheduling so the chime mixes
        // over Apple Music without stopping it (iOS locks the category at creation time).
        const ctx = app._ensureAudioSession('ambient');
        this.requestNotifyPermission(); // ask on a real user gesture, not on view-open
        if (this.state.remainingSeconds <= 0) this.arm(this.state.mode);
        this.state.isRunning = true;
        this.setPlayLabel(true);
        document.getElementById('app').classList.add('running');
        app.requestWakeLock();

        // drift-corrected: track an absolute end timestamp, not tick counts
        this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;

        // look-ahead: schedule this phase's completion chime on the audio clock
        app._clearSchedule();
        if (ctx) {
            app._seqAt(this.ALARMS[this.state.settings.sound] || this.ALARMS[0], ctx.currentTime + this.state.remainingSeconds);
            app._finalAlarmAt = ctx.currentTime + this.state.remainingSeconds;
        }
        app._keepAliveOn();
        app._mediaOn(this.modeLabel(this.state.mode), 'Pomodoro');
        app.prepareAlarmClip({ kind: 'seq', alarm: this.ALARMS[this.state.settings.sound] || this.ALARMS[0] });

        this.state.timerId = setInterval(() => {
            const remMs = this.state.endTime - performance.now();
            this.state.remainingSeconds = Math.max(0, Math.ceil(remMs / 1000));
            if (remMs <= 0) this.complete();
            else this.updateText();
        }, 250);

        this.updateText();
        this._raf();
    },

    pause() {
        if (this.state.endTime) {
            this.state.remainingSeconds = Math.max(0, Math.ceil((this.state.endTime - performance.now()) / 1000));
        }
        this.stopTicking();
        this.setPlayLabel(false);
        document.getElementById('app').classList.remove('running');
        app.releaseWakeLock();
        this.render();
    },

    stopTicking() {
        this.state.isRunning = false;
        if (this.state.timerId) { clearInterval(this.state.timerId); this.state.timerId = null; }
        if (this.state.rafId) { cancelAnimationFrame(this.state.rafId); this.state.rafId = null; }
        app._stopTimerAudio();
    },

    // Reset: re-arm the CURRENT phase from full
    reset() {
        app.releaseWakeLock();
        this.arm(this.state.mode);
        document.title = 'lunatimer';
    },

    // Skip: jump to the next phase without counting the current one as complete
    skip() {
        this.stopTicking();
        app.releaseWakeLock();
        this.arm(this.nextMode(false));
        document.title = 'lunatimer';
    },

    // manually jump to a specific phase via the pills
    pickMode(mode) {
        if (mode === this.state.mode && !this.state.isRunning) return;
        this.stopTicking();
        app.releaseWakeLock();
        this.arm(mode);
        document.title = 'lunatimer';
    },

    // compute the phase that follows the current one.
    // countWork=true means a work phase just finished and should advance the cycle.
    nextMode(countWork) {
        if (this.state.mode === 'work') {
            if (countWork) this.state.cycle += 1;
            const due = this.state.cycle > 0 && this.state.cycle % this.state.settings.interval === 0;
            return due ? 'long' : 'short';
        }
        // after any break, go back to work; a long break closes the cycle
        if (this.state.mode === 'long') this.state.cycle = 0;
        return 'work';
    },

    // phase reached 00:00
    complete() {
        const finished = this.state.mode;
        const fg = document.visibilityState === 'visible';
        if (fg) app._clearScheduleAll();   // we'll ring live; drop the pre-scheduled chime
        this.stopTicking();
        // Foreground: ring live (audible over music). Background: pre-scheduled chime already fired.
        if (fg && !app.playAlarmClip()) app._ringNowSeq(this.ALARMS[this.state.settings.sound] || this.ALARMS[0]);
        app.releaseWakeLock();

        if (finished === 'work') {
            this.state.totalDone += 1;
        }
        const next = this.nextMode(finished === 'work');
        this.saveStats();

        this.notify(finished, next);

        // auto-arm the next phase (user presses Start to begin it)
        this.arm(next);
        document.title = 'lunatimer';
    },

    // ---- rendering ----
    setPlayLabel(running) {
        document.getElementById('pomo-play-label').innerText = running ? 'Pause' : 'Start';
    },

    render() {
        document.getElementById('pomo-mode').innerText = this.modeLabel(this.state.mode);
        this.renderPills();
        this.updateText();
        this.renderDots();
    },

    updateText() {
        const el = document.getElementById('pomo-time');
        const txt = this.clock(this.state.remainingSeconds);
        el.innerText = txt;
        el.classList.toggle('t-long', txt.length >= 7);
        el.classList.toggle('t-xlong', txt.length >= 8);

        // live tab title while running
        if (this.state.isRunning) {
            document.title = `(${txt}) ${this.modeLabel(this.state.mode)}`;
        }
        // paint ring immediately for paused/armed states
        if (!this.state.isRunning) {
            const frac = this.state.totalSeconds ? this.state.remainingSeconds / this.state.totalSeconds : 0;
            this.paint(frac);
        }
    },

    _raf() {
        if (!this.state.isRunning) return;
        const remMs = Math.max(0, this.state.endTime - performance.now());
        const frac = this.state.totalSeconds ? (remMs / 1000) / this.state.totalSeconds : 0;
        this.paint(frac);
        this.state.rafId = requestAnimationFrame(() => this._raf());
    },

    paint(frac) {
        // frac = remaining fraction; the bar fills as time elapses
        const pct = Math.max(0, Math.min(100, (1 - frac) * 100));
        document.getElementById('pomo-bar-fill').style.width = pct + '%';
    },

    renderPills() {
        document.querySelectorAll('#pomo-modes .pomo-pill').forEach(p => {
            p.classList.toggle('active', p.dataset.m === this.state.mode);
        });
    },

    renderDots() {
        const wrap = document.getElementById('pomo-dots');
        const total = this.state.settings.interval;
        // during the long break the cycle is "full" — show every dot lit
        const filled = this.state.mode === 'long' ? total : (this.state.cycle % total);
        wrap.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const d = document.createElement('div');
            d.className = 'dot' + (i < filled ? ' filled' : '');
            wrap.appendChild(d);
        }
    },

    clock(totalSec) {
        const s = Math.max(0, Math.round(totalSec));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const mm = m.toString().padStart(2, '0'), ss = sec.toString().padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    },

    // ---- settings screen ----
    openSettings() {
        const s = this.state.settings;
        document.getElementById('pomo-work').value = s.work;
        document.getElementById('pomo-short').value = s.short;
        document.getElementById('pomo-long').value = s.long;
        document.getElementById('pomo-interval').value = s.interval;
        this.renderAlarms();
        this.renderStats();
        app.switchView('view-pomo-settings');
    },

    // build the 5-alarm chooser; tapping one selects + previews it
    renderAlarms() {
        const list = document.getElementById('pomo-sounds');
        if (!list) return;
        list.innerHTML = '';
        this.ALARMS.forEach((a, i) => {
            const div = document.createElement('div');
            div.className = 'sound-item' + (i === this.state.settings.sound ? ' selected' : '');
            div.innerHTML = `
                <div>
                    <div class="s-name">${a.name}</div>
                    <div class="s-sub">${a.desc}</div>
                </div>
                <div class="s-check">&#10003;</div>`;
            div.onclick = () => {
                this.state.settings.sound = i;
                this.saveSettingsStore();
                this.renderAlarms();
                this.playAlarm(i); // preview
            };
            list.appendChild(div);
        });
    },

    saveSettings() {
        const clamp = (v, min, max, def) => {
            const n = parseInt(v, 10);
            return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
        };
        const s = this.state.settings;
        s.work     = clamp(document.getElementById('pomo-work').value, 1, 180, s.work);
        s.short    = clamp(document.getElementById('pomo-short').value, 1, 120, s.short);
        s.long     = clamp(document.getElementById('pomo-long').value, 1, 120, s.long);
        s.interval = clamp(document.getElementById('pomo-interval').value, 1, 12, s.interval);
        this.saveSettingsStore();
        // if idle, re-arm current phase so the new duration takes effect immediately
        if (!this.state.isRunning) this.arm(this.state.mode);
        app.switchView('view-pomodoro');
        this.render();
    },

    renderStats() {
        const total = this.state.settings.interval;
        const cur = this.state.mode === 'long' ? total : (this.state.cycle % total);
        document.getElementById('pomo-stats').innerHTML =
            `Completed pomodoros: <strong>${this.state.totalDone}</strong><br>` +
            `Current cycle: <strong>${cur}/${total}</strong>`;
    },

    async resetStats() {
        const ok = await app.confirmDialog('Reset completed-pomodoro stats?', 'Reset Stats');
        if (!ok) return;
        this.state.totalDone = 0;
        this.state.cycle = 0;
        this.saveStats();
        this.renderStats();
        this.renderDots();
    },

    // ---- notifications ----
    requestNotifyPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try { Notification.requestPermission(); } catch (e) {}
        }
    },
    notify(finished, next) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const body = finished === 'work'
            ? `Focus done. Time for a ${this.modeLabel(next).toLowerCase()}.`
            : `${this.modeLabel(finished)} over. Back to focus.`;
        try { new Notification('Pomodoro', { body, silent: false }); } catch (e) {}
    },

    // ---- play a chosen alarm sequence (used for settings preview) ----
    playAlarm(index) {
        const ctx = app._ctx();
        if (!ctx) return;
        app._seqAt(this.ALARMS[index] || this.ALARMS[0], ctx.currentTime);
    },

    // fired when a phase reaches 00:00
    chime() { this.playAlarm(this.state.settings.sound); },
};

pomodoro.load();

// =====================================================================
//  TIMEBOX  — task-based fixed time blocks (hard / soft), one at a time.
//  Self-contained; reuses app.audioCtx / wake lock and pomodoro's ALARMS.
// =====================================================================
const timebox = {
    _nextId: 1,
    _addMode: 'hard',   // mode selected in the add-task form
    _editingId: null,   // task id currently being edited (null = adding new)
    _formSubs: [],      // sub-tasks being edited in the add/edit form
    _pendingShare: null,// a routine parsed from a ?r= share link, awaiting import

    state: {
        tasks: [],           // [{id, name, minutes, mode:'hard'|'soft'|'break', note, done, skipped}]
        sound: 0,            // index into pomodoro.ALARMS
        autoStart: false,    // auto-start the next task when one completes
        routines: [],        // [{name, tasks:[{name,minutes,mode,note}]}]
        history: [],         // [{date, completed, total, focusSec}]
        session: null,       // per-run tally: {planned,spent,overtime,status} keyed by task id
        activeIndex: -1,     // task currently armed/running
        remainingSeconds: 0,
        totalSeconds: 0,
        isRunning: false,
        overtime: false,     // soft task ran out, awaiting extend/complete
        endTime: 0,
        timerId: null,
        rafId: null,
    },
    _segStart: null,         // performance.now() when the current run segment began

    // ---- persistence ----
    load() {
        let t = null, s = null;
        try { t = JSON.parse(localStorage.getItem('timeboxTasks')); } catch (e) {}
        try { s = JSON.parse(localStorage.getItem('timeboxSound')); } catch (e) {}
        if (Array.isArray(t) && t.length) {
            this.state.tasks = t.map(x => this._normTask(x));
        } else {
            // sensible starter list
            this.state.tasks = [
                { id: 1, name: 'Plan the day', minutes: 10, mode: 'soft', note: '', subs: [], done: false, skipped: false },
                { id: 2, name: 'Deep work',    minutes: 50, mode: 'hard', note: '', subs: [], done: false, skipped: false },
                { id: 3, name: 'Emails',        minutes: 25, mode: 'hard', note: '', subs: [], done: false, skipped: false },
            ];
        }
        this._nextId = this.state.tasks.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        const si = Number.isFinite(s) ? s : 0;
        this.state.sound = (si >= 0 && si < pomodoro.ALARMS.length) ? si : 0;
        this.state.autoStart = localStorage.getItem('timeboxAutoStart') === '1';
        try { const r = JSON.parse(localStorage.getItem('timeboxRoutines')); if (Array.isArray(r)) this.state.routines = r; } catch (e) {}
        try { const h = JSON.parse(localStorage.getItem('timeboxHistory')); if (Array.isArray(h)) this.state.history = h; } catch (e) {}
    },
    _normTask(x) {
        const mode = (x.mode === 'soft' || x.mode === 'break') ? x.mode : 'hard';
        const subs = Array.isArray(x.subs)
            ? x.subs.map(s => ({ text: String((s && s.text != null ? s.text : s) || '').slice(0, 80), done: !!(s && s.done) }))
                   .filter(s => s.text)
            : [];
        return {
            id: x.id != null ? x.id : this._nextId++,
            name: String(x.name || 'Task'),
            minutes: Math.max(1, parseInt(x.minutes, 10) || 25),
            mode,
            note: String(x.note || ''),
            subs,
            done: !!x.done,
            skipped: !!x.skipped,
        };
    },
    saveTasks() { localStorage.setItem('timeboxTasks', JSON.stringify(this.state.tasks)); },
    saveSound() { localStorage.setItem('timeboxSound', JSON.stringify(this.state.sound)); },
    saveAutoStart() { localStorage.setItem('timeboxAutoStart', this.state.autoStart ? '1' : '0'); },
    saveRoutines() { localStorage.setItem('timeboxRoutines', JSON.stringify(this.state.routines)); },
    saveHistory() { localStorage.setItem('timeboxHistory', JSON.stringify(this.state.history.slice(-120))); },
    toggleAutoStart() { this.state.autoStart = !this.state.autoStart; this.saveAutoStart(); this._applyAutoStartUI(); },

    // ---- helpers ----
    activeTask() { return this.state.tasks[this.state.activeIndex] || null; },
    firstUndone() {
        const i = this.state.tasks.findIndex(t => !this.isDone(t));
        return i === -1 ? (this.state.tasks.length ? 0 : -1) : i;
    },
    isDone(t) { return t.done || t.skipped; },
    remainingTasks() { return this.state.tasks.filter(t => !this.isDone(t)); },

    // total planned minutes over the tasks still to do, and the wall-clock ETA
    planSummary() {
        const rem = this.remainingTasks();
        const mins = rem.reduce((s, t) => s + t.minutes, 0);
        return { count: rem.length, minutes: mins };
    },
    fmtDur(mins) {
        const h = Math.floor(mins / 60), m = mins % 60;
        if (h && m) return `${h}h ${m}m`;
        if (h) return `${h}h`;
        return `${m}m`;
    },
    fmtClock(d) {
        let h = d.getHours(), m = d.getMinutes();
        const ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12; if (h === 0) h = 12;
        return `${h}:${m.toString().padStart(2, '0')} ${ap}`;
    },

    // ---- per-run session tally (planned vs actual, for the summary screen) ----
    _ensureSession() {
        if (!this.state.session) this.state.session = { started: true, rows: {} };
        return this.state.session;
    },
    _sessRow(task) {
        const sess = this._ensureSession();
        if (!sess.rows[task.id]) {
            sess.rows[task.id] = { name: task.name, mode: task.mode, planned: task.minutes * 60, spent: 0, overtime: 0, status: 'pending' };
        }
        return sess.rows[task.id];
    },
    // accumulate elapsed time on the running segment into the active task's tally
    _accrue() {
        if (this._segStart == null) return;
        const task = this.activeTask();
        const elapsed = Math.max(0, (performance.now() - this._segStart) / 1000);
        this._segStart = null;
        if (!task) return;
        const row = this._sessRow(task);
        row.spent += elapsed;
        if (row.spent > row.planned) row.overtime = row.spent - row.planned;
    },

    // ---- open the screen ----
    open() {
        if (!this.state.tasks.length && this.state.activeIndex === -1) this.load();
        // pick an active task if none armed (or the armed one vanished)
        if (this.state.activeIndex < 0 || this.state.activeIndex >= this.state.tasks.length) {
            const i = this.firstUndone();
            if (i >= 0) this.arm(i); else this._clearArm();
        }
        app.switchView('view-timebox');
        this.render();
    },

    _clearArm() {
        this.stopTicking();
        this.state.activeIndex = -1;
        this.state.totalSeconds = 0;
        this.state.remainingSeconds = 0;
        this.state.overtime = false;
    },

    // arm (but don't start) a task by index
    arm(index) {
        const task = this.state.tasks[index];
        if (!task) { this._clearArm(); this.render(); return; }
        this.stopTicking();
        this.state.activeIndex = index;
        this.state.totalSeconds = task.minutes * 60;
        this.state.remainingSeconds = this.state.totalSeconds;
        this.state.isRunning = false;
        this.state.overtime = false;
        this.setPlayLabel(false);
        document.getElementById('app').classList.remove('running');
        document.getElementById('tb-card').classList.remove('overtime');
        this.render();
    },

    // tap a task in the main list -> arm it
    pickTask(index) {
        if (index === this.state.activeIndex && !this.state.isRunning && !this.state.overtime) return;
        this.clearUndoSkip();
        this.stopTicking();
        app.releaseWakeLock();
        this.arm(index);
        document.title = 'lunatimer';
    },

    // ---- controls ----
    toggle() { this.state.isRunning ? this.pause() : this.start(); },

    start() {
        if (!this.activeTask()) { this.openTasks(); return; }
        // grab the audio session under 'ambient' BEFORE scheduling so the chime mixes
        // over Apple Music without stopping it (iOS locks the category at creation time).
        const ctx = app._ensureAudioSession('ambient');
        this.requestNotifyPermission(); // ask on a real user gesture, not on view-open
        if (this.state.overtime) return; // must extend/complete first
        if (this.state.remainingSeconds <= 0) this.arm(this.state.activeIndex);
        this.state.isRunning = true;
        this.setPlayLabel(true);
        this._segStart = performance.now();
        this._sessRow(this.activeTask());   // ensure a tally row exists
        document.getElementById('app').classList.add('running');
        app.requestWakeLock();

        this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;

        // look-ahead: schedule this task's completion chime on the audio clock
        app._clearSchedule();
        const _al = pomodoro.ALARMS[this.state.sound] || pomodoro.ALARMS[0];
        if (ctx) {
            app._seqAt(_al, ctx.currentTime + this.state.remainingSeconds);
            app._finalAlarmAt = ctx.currentTime + this.state.remainingSeconds;
        }
        app._keepAliveOn();
        app._mediaOn(this.activeTask() ? this.activeTask().name : 'Timebox', 'Timebox');
        app.prepareAlarmClip({ kind: 'seq', alarm: pomodoro.ALARMS[this.state.sound] || pomodoro.ALARMS[0] });

        this.state.timerId = setInterval(() => {
            const remMs = this.state.endTime - performance.now();
            this.state.remainingSeconds = Math.max(0, Math.ceil(remMs / 1000));
            if (remMs <= 0) this.complete();
            else this.updateText();
        }, 250);

        this.updateText();
        this._raf();
    },

    pause() {
        if (this.state.endTime) {
            this.state.remainingSeconds = Math.max(0, Math.ceil((this.state.endTime - performance.now()) / 1000));
        }
        this.stopTicking();
        this.setPlayLabel(false);
        document.getElementById('app').classList.remove('running');
        app.releaseWakeLock();
        this.render();
    },

    stopTicking() {
        this.state.isRunning = false;
        if (this.state.timerId) { clearInterval(this.state.timerId); this.state.timerId = null; }
        if (this.state.rafId) { cancelAnimationFrame(this.state.rafId); this.state.rafId = null; }
        app._stopTimerAudio();
    },

    // Reset: restart the current task from scratch — full time, cleared checklist
    reset() {
        this._accrue();
        app.releaseWakeLock();
        this.clearUndoSkip();
        const task = this.activeTask();
        if (task) {
            // fresh restart: un-tick this task's sub-tasks and drop done/skip marks
            if (task.subs && task.subs.length) task.subs.forEach(s => s.done = false);
            task.done = false; task.skipped = false;
            // reset this task's session tally so planned-vs-actual starts clean
            if (this.state.session && this.state.session.rows[task.id]) {
                delete this.state.session.rows[task.id];
            }
            this.saveTasks();
        }
        document.getElementById('tb-card').classList.remove('overtime');
        this.state.overtime = false;
        if (this.state.activeIndex >= 0) this.arm(this.state.activeIndex);
        else this.render();
        document.title = 'lunatimer';
    },

    // Next: advance to the following task (does NOT mark current done)
    next() {
        this._accrue();
        this.stopTicking();
        app.releaseWakeLock();
        document.getElementById('tb-card').classList.remove('overtime');
        this.state.overtime = false;
        const n = this.state.tasks.length;
        if (!n) { this._clearArm(); this.render(); return; }
        const nextIdx = (this.state.activeIndex + 1) % n;
        this.arm(nextIdx);
        document.title = 'lunatimer';
    },

    // Skip: mark the current task skipped (not done) and advance
    skip() {
        this._accrue();
        this.stopTicking();
        document.getElementById('tb-card').classList.remove('overtime');
        this.state.overtime = false;
        const task = this.activeTask();
        if (task) {
            // remember enough to fully restore the task if this was a misfire
            this._undoSkip = {
                id: task.id,
                index: this.state.activeIndex,
                remaining: this.state.remainingSeconds,
                total: this.state.totalSeconds,
                sessStatus: (this.state.session && this.state.session.rows[task.id]) ? this.state.session.rows[task.id].status : null,
            };
            task.skipped = true; task.done = false;
            const row = this._sessRow(task); row.status = 'skipped';
            this.saveTasks();
            this.showUndoSkip(task.name);
        }
        this._advance(false);
    },

    // restore the most recently skipped task and re-arm it
    undoSkip() {
        const u = this._undoSkip;
        this._undoSkip = null;
        this.clearUndoSkip();
        if (!u) return;
        const idx = this.state.tasks.findIndex(t => t.id === u.id);
        if (idx < 0) return;
        const task = this.state.tasks[idx];
        task.skipped = false; task.done = false;
        if (this.state.session && this.state.session.rows[u.id]) {
            this.state.session.rows[u.id].status = u.sessStatus || 'pending';
        }
        this.saveTasks();
        this.stopTicking();
        this.arm(idx);
        // arm() resets to a full task; restore where the timer actually was
        if (u.remaining > 0) {
            this.state.totalSeconds = u.total || task.minutes * 60;
            this.state.remainingSeconds = u.remaining;
        }
        this.render();
        document.title = 'lunatimer';
    },

    showUndoSkip(name) {
        const bar = document.getElementById('tb-undo');
        if (!bar) return;
        const label = document.getElementById('tb-undo-label');
        if (label) label.innerText = `Skipped “${name}”`;
        bar.classList.add('show');
        clearTimeout(this._undoTimer);
        this._undoTimer = setTimeout(() => this.clearUndoSkip(), 6000);
    },
    clearUndoSkip() {
        clearTimeout(this._undoTimer);
        const bar = document.getElementById('tb-undo');
        if (bar) bar.classList.remove('show');
    },

    // task reached 00:00
    complete() {
        this._accrue();
        const task = this.activeTask();
        const fg = document.visibilityState === 'visible';
        if (fg) app._clearScheduleAll();   // we'll ring live; drop the pre-scheduled chime
        this.stopTicking();
        // Foreground: ring live (audible over music). Background: pre-scheduled chime already fired.
        if (fg && !app.playAlarmClip()) app._ringNowSeq(pomodoro.ALARMS[this.state.sound] || pomodoro.ALARMS[0]);
        app.releaseWakeLock();

        if (!task) { this.render(); return; }

        if (task.mode === 'soft') {
            // soft: hold at 0 and offer to extend or complete
            this.state.overtime = true;
            this.state.remainingSeconds = 0;
            this.notify(task, 'soft');
            document.getElementById('app').classList.remove('running');
            this.setPlayLabel(false);
            this.render();
            document.getElementById('tb-card').classList.add('overtime');
            document.title = 'lunatimer';
            return;
        }

        // hard / break: stop immediately, mark done, move on
        this.notify(task, task.mode);
        this._markDoneAndAdvance();
    },

    // soft-overtime: add more time and keep going
    extend(mins) {
        const task = this.activeTask();
        if (!task) return;
        this.state.overtime = false;
        document.getElementById('tb-card').classList.remove('overtime');
        this.state.totalSeconds += mins * 60;   // grow the bar so progress stays sensible
        this.state.remainingSeconds = mins * 60;
        this.start();
    },

    // soft-overtime: accept as complete, advance
    finishTask() {
        document.getElementById('tb-card').classList.remove('overtime');
        this.state.overtime = false;
        this._markDoneAndAdvance();
    },

    _markDoneAndAdvance() {
        const task = this.activeTask();
        if (task) {
            task.done = true; task.skipped = false;
            const row = this._sessRow(task); row.status = 'done';
            this.saveTasks();
        }
        this._advance(true);
    },

    // advance to the next unfinished task; auto-start it if enabled and the run
    // isn't over. `wasComplete` distinguishes a natural finish from a manual skip.
    _advance(wasComplete) {
        const nextIdx = this.firstUndone();
        const more = nextIdx >= 0 && this.state.tasks.some(t => !this.isDone(t));
        if (more) {
            this.arm(nextIdx);
            document.title = 'lunatimer';
            if (this.state.autoStart) {
                // skip past break tasks? no — run them too, they're intentional pauses
                this.start();
            }
        } else {
            // whole routine finished — record it and show the summary
            this._clearArm();
            this.render();
            document.title = 'lunatimer';
            this._finishSession();
        }
    },

    // roll the session tally into history and show the summary screen
    _finishSession() {
        const sess = this.state.session;
        if (!sess) return;
        const rows = Object.values(sess.rows);
        const completed = rows.filter(r => r.status === 'done').length;
        const focusSec = rows.reduce((s, r) => s + r.spent, 0);
        const dt = new Date();
        const entry = {
            date: `${dt.getFullYear()}-${(dt.getMonth() + 1).toString().padStart(2, '0')}-${dt.getDate().toString().padStart(2, '0')}`,
            completed, total: rows.length, focusSec: Math.round(focusSec),
        };
        this.state.history.push(entry);
        this.saveHistory();
        this.renderSummary(rows);
        this.state.session = null;
        app.switchView('view-timebox-summary');
    },

    // toggle a task's done state from the list (without running it)
    toggleDone(index) {
        const t = this.state.tasks[index];
        if (!t) return;
        t.done = !t.done;
        if (t.done) t.skipped = false;
        this.saveTasks();
        this.renderList();
        this.renderCount();
        this.renderPlan();
    },

    // clear all done/skipped flags so the routine can run again from the top
    resetAll() {
        this._accrue();
        this.stopTicking();
        this.state.session = null;
        this.state.tasks.forEach(t => { t.done = false; t.skipped = false; });
        this.saveTasks();
        document.getElementById('tb-card').classList.remove('overtime');
        this.state.overtime = false;
        const i = this.firstUndone();
        if (i >= 0) this.arm(i); else this._clearArm();
        this.render();
    },

    // ---- rendering ----
    setPlayLabel(running) {
        document.getElementById('tb-play-label').innerText = running ? 'Pause' : 'Start';
    },

    render() {
        const task = this.activeTask();
        document.getElementById('tb-name').innerText = task ? task.name : 'No task';
        const badge = document.getElementById('tb-badge');
        if (task) {
            badge.style.display = '';
            badge.innerText = task.mode === 'soft' ? 'Soft' : task.mode === 'break' ? 'Break' : 'Hard';
            badge.className = 'tb-badge ' + task.mode;
        } else {
            badge.style.display = 'none';
        }
        const note = document.getElementById('tb-note');
        if (note) {
            if (task && task.note) { note.innerText = task.note; note.style.display = ''; }
            else { note.innerText = ''; note.style.display = 'none'; }
        }
        this.renderSubs();
        this.updateText();
        this.renderCount();
        this.renderPlan();
        this.renderList();
    },

    // checklist of sub-tasks for the active task, tickable while it runs
    renderSubs() {
        const wrap = document.getElementById('tb-subs');
        if (!wrap) return;
        const task = this.activeTask();
        wrap.innerHTML = '';
        if (!task || !task.subs || !task.subs.length) { wrap.style.display = 'none'; return; }
        wrap.style.display = '';
        task.subs.forEach((s, i) => {
            const row = document.createElement('div');
            row.className = 'tb-sub' + (s.done ? ' done' : '');
            row.innerHTML = `<span class="tb-sub-check">&#10003;</span><span class="tb-sub-text">${this.esc(s.text)}</span>`;
            row.onclick = () => this.toggleSub(i);
            wrap.appendChild(row);
        });
    },
    toggleSub(i) {
        const task = this.activeTask();
        if (!task || !task.subs || !task.subs[i]) return;
        task.subs[i].done = !task.subs[i].done;
        this.saveTasks();
        this.renderSubs();
    },

    updateText() {
        const el = document.getElementById('tb-time');
        const txt = this.clock(this.state.remainingSeconds);
        el.innerText = txt;
        el.classList.toggle('t-long', txt.length >= 7);
        el.classList.toggle('t-xlong', txt.length >= 8);

        if (this.state.isRunning) {
            const t = this.activeTask();
            document.title = `(${txt}) ${t ? t.name : 'Timebox'}`;
        }
        if (!this.state.isRunning) {
            const frac = this.state.totalSeconds ? this.state.remainingSeconds / this.state.totalSeconds : 0;
            this.paint(frac);
        }
    },

    _raf() {
        if (!this.state.isRunning) return;
        const remMs = Math.max(0, this.state.endTime - performance.now());
        const frac = this.state.totalSeconds ? (remMs / 1000) / this.state.totalSeconds : 0;
        this.paint(frac);
        this.state.rafId = requestAnimationFrame(() => this._raf());
    },

    paint(frac) {
        const pct = Math.max(0, Math.min(100, (1 - frac) * 100));
        document.getElementById('tb-bar-fill').style.width = pct + '%';
    },

    renderCount() {
        const el = document.getElementById('tb-count');
        const n = this.state.tasks.length;
        if (!n) { el.innerText = ''; return; }
        const done = this.state.tasks.filter(t => t.done).length;
        const skipped = this.state.tasks.filter(t => t.skipped).length;
        const pos = this.state.activeIndex >= 0 ? `Task ${this.state.activeIndex + 1} of ${n}` : 'All done';
        let tail = `${done}/${n} done`;
        if (skipped) tail += ` · ${skipped} skipped`;
        el.innerText = `${pos} · ${tail}`;
    },

    // total remaining time + finish-by ETA
    renderPlan() {
        const el = document.getElementById('tb-plan');
        if (!el) return;
        const { count, minutes } = this.planSummary();
        if (!count || !minutes) { el.innerText = ''; return; }
        // ETA counts down from whatever's left of the running task, not full plan
        let secLeft = minutes * 60;
        if (this.state.isRunning || this.state.remainingSeconds > 0) {
            const act = this.activeTask();
            if (act && !this.isDone(act)) secLeft = secLeft - act.minutes * 60 + this.state.remainingSeconds;
        }
        const eta = new Date(performance.timeOrigin + performance.now() + secLeft * 1000);
        el.innerText = `${this.fmtDur(minutes)} left · done by ${this.fmtClock(eta)}`;
    },

    renderList() {
        const wrap = document.getElementById('tb-list');
        wrap.innerHTML = '';
        if (!this.state.tasks.length) {
            const e = document.createElement('div');
            e.className = 'tb-empty';
            e.innerText = 'No tasks yet — tap “Tasks” to add some.';
            wrap.appendChild(e);
            return;
        }
        this.state.tasks.forEach((t, i) => {
            const row = document.createElement('div');
            row.className = 'tb-item' + (i === this.state.activeIndex ? ' active' : '')
                + (t.done ? ' done' : '') + (t.skipped ? ' skipped' : '') + (t.mode === 'break' ? ' is-break' : '');
            const meta = `${t.minutes} min · ${t.mode}${t.skipped ? ' · skipped' : ''}`;
            row.innerHTML = `
                <div class="tb-check">&#10003;</div>
                <div class="tb-item-body">
                    <div class="tb-item-name">${this.esc(t.name)}</div>
                    <div class="tb-item-meta">${meta}</div>
                </div>
                <button class="tb-item-edit" title="Edit task" aria-label="Edit task"></button>`;
            row.onclick = () => this.pickTask(i);
            const chk = row.querySelector('.tb-check');
            chk.onclick = (e) => { e.stopPropagation(); this.toggleDone(i); };
            const edit = row.querySelector('.tb-item-edit');
            edit.onclick = (e) => { e.stopPropagation(); this.editFromList(i); };
            wrap.appendChild(row);
        });
    },

    clock(totalSec) {
        const s = Math.max(0, Math.round(totalSec));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const mm = m.toString().padStart(2, '0'), ss = sec.toString().padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    },

    esc(str) {
        return String(str).replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    },

    // ---- task editor ----
    openTasks() {
        this._addMode = 'hard';
        this._editingId = null;
        this._resetForm();
        this._applyModeUI();
        this._applyAutoStartUI();
        this.renderEditList();
        this.renderSounds();
        this.renderRoutines();
        app.switchView('view-timebox-tasks');
    },

    // reset the add/edit form back to its default "add new" state
    _resetForm() {
        const nameEl = document.getElementById('tb-in-name');
        const minEl = document.getElementById('tb-in-min');
        const noteEl = document.getElementById('tb-in-note');
        const subEl = document.getElementById('tb-in-sub');
        if (nameEl) nameEl.value = '';
        if (minEl) minEl.value = '25';
        if (noteEl) noteEl.value = '';
        if (subEl) subEl.value = '';
        this._formSubs = [];
        this.renderFormSubs();
        document.getElementById('tb-add-btn').innerText = '+ Add Task';
        document.getElementById('tb-cancel-edit').style.display = 'none';
    },

    // ---- sub-task editing (in the add/edit form) ----
    addFormSub() {
        const el = document.getElementById('tb-in-sub');
        if (!el) return;
        const text = (el.value || '').trim().slice(0, 80);
        if (!text) return;
        this._formSubs.push({ text, done: false });
        el.value = '';
        el.focus();
        this.renderFormSubs();
    },
    removeFormSub(i) {
        this._formSubs.splice(i, 1);
        this.renderFormSubs();
    },
    renderFormSubs() {
        const wrap = document.getElementById('tb-in-sublist');
        if (!wrap) return;
        wrap.innerHTML = '';
        this._formSubs.forEach((s, i) => {
            const row = document.createElement('div');
            row.className = 'tb-subedit';
            row.innerHTML = `<span>${this.esc(s.text)}</span><button class="tb-sub-x" aria-label="Remove">&times;</button>`;
            row.querySelector('.tb-sub-x').onclick = () => this.removeFormSub(i);
            wrap.appendChild(row);
        });
    },

    // quick-duration chips
    setMinutes(m) {
        const minEl = document.getElementById('tb-in-min');
        if (minEl) minEl.value = m;
    },

    setAddMode(mode) {
        this._addMode = (mode === 'soft' || mode === 'break') ? mode : 'hard';
        this._applyModeUI();
    },
    _applyModeUI() {
        document.querySelectorAll('#tb-mode-toggle .unit-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === this._addMode);
        });
        const hint = this._addMode === 'soft'
            ? 'Soft: keep a few extra minutes if you’re close.'
            : this._addMode === 'break'
            ? 'Break: a timed pause between tasks.'
            : 'Hard: stop the moment time runs out.';
        document.getElementById('tb-mode-hint').innerText = hint;
    },
    _applyAutoStartUI() {
        const el = document.getElementById('tb-autostart');
        if (el) el.classList.toggle('on', this.state.autoStart);
        const t = document.getElementById('tb-autostart-track');
        if (t) t.classList.toggle('on', this.state.autoStart);
    },

    async addTask() {
        const nameEl = document.getElementById('tb-in-name');
        const minEl = document.getElementById('tb-in-min');
        const noteEl = document.getElementById('tb-in-note');
        let name = (nameEl.value || '').trim();
        const note = (noteEl ? noteEl.value : '').trim();
        const minutes = Math.max(1, Math.min(600, parseInt(minEl.value, 10) || 0));
        if (!name && this._addMode === 'break') name = 'Break';
        if (!name) { await app.alertDialog('Enter a task name first.'); return; }
        if (!minutes) { await app.alertDialog('Enter a valid number of minutes.'); return; }

        // editing an existing task
        if (this._editingId != null) {
            const t = this.state.tasks.find(x => x.id === this._editingId);
            if (t) {
                t.name = name;
                t.minutes = minutes;
                t.mode = this._addMode;
                t.note = note;
                t.subs = this._formSubs.map(s => ({ text: s.text, done: !!s.done }));
                this.saveTasks();
                // if it's the armed task and idle, re-arm so the new minutes take effect
                const act = this.activeTask();
                if (act && act.id === t.id && !this.state.isRunning && !this.state.overtime) {
                    this.arm(this.state.activeIndex);
                }
            }
            this.cancelEdit();       // resets form + label, re-renders the list
            this.renderCount();
            return;
        }

        // adding a new task
        this.state.tasks.push({ id: this._nextId++, name, minutes, mode: this._addMode, note, subs: this._formSubs.map(s => ({ text: s.text, done: false })), done: false, skipped: false });
        this.saveTasks();
        nameEl.value = '';
        minEl.value = '25';
        if (noteEl) noteEl.value = '';
        this._formSubs = [];
        this.renderFormSubs();
        // if nothing was armed, arm the new task
        if (this.state.activeIndex < 0) this.arm(this.state.tasks.length - 1);
        this.renderEditList();
        this.renderCount();
    },

    // duplicate a task in the editor
    duplicateTask(index) {
        const t = this.state.tasks[index];
        if (!t) return;
        const copy = this._normTask({
            name: t.name + ' copy', minutes: t.minutes, mode: t.mode, note: t.note,
            subs: (t.subs || []).map(s => ({ text: s.text, done: false })),
        });
        this.state.tasks.splice(index + 1, 0, copy);
        if (index < this.state.activeIndex) this.state.activeIndex += 1;
        this.saveTasks();
        this.renderEditList();
        this.renderCount();
    },

    // jump straight from the main task list into editing a specific task
    editFromList(index) {
        const t = this.state.tasks[index];
        if (!t) return;
        this.openTasks();      // switch to the editor screen (resets the form)
        this.editTask(index);  // then load this task into the form
    },

    // load a task into the form for editing
    editTask(index) {        const t = this.state.tasks[index];
        if (!t) return;
        this._editingId = t.id;
        document.getElementById('tb-in-name').value = t.name;
        document.getElementById('tb-in-min').value = t.minutes;
        const noteEl = document.getElementById('tb-in-note');
        if (noteEl) noteEl.value = t.note || '';
        this._formSubs = (t.subs || []).map(s => ({ text: s.text, done: !!s.done }));
        this.renderFormSubs();
        this.setAddMode(t.mode);
        document.getElementById('tb-add-btn').innerText = 'Save Task';
        document.getElementById('tb-cancel-edit').style.display = 'block';
        this.renderEditList();
        const nameEl = document.getElementById('tb-in-name');
        nameEl.focus();
        nameEl.scrollIntoView({ block: 'nearest' });
    },

    // abandon an in-progress edit and return the form to "add new"
    cancelEdit() {
        this._editingId = null;
        this._addMode = 'hard';
        this._formSubs = [];
        this._resetForm();
        this._applyModeUI();
        this.renderEditList();
    },

    async deleteTask(index) {
        const t = this.state.tasks[index];
        if (!t) return;
        const ok = await app.confirmDialog(`Delete task “${t.name}”?`, 'Delete Task');
        if (!ok) return;
        const wasActive = index === this.state.activeIndex;
        if (this._editingId === t.id) { this._editingId = null; this._resetForm(); }
        this.state.tasks.splice(index, 1);
        this.saveTasks();
        // fix up the active index
        if (wasActive) {
            this.stopTicking();
            const i = this.firstUndone();
            if (i >= 0) this.arm(i); else this._clearArm();
        } else if (index < this.state.activeIndex) {
            this.state.activeIndex -= 1;
        }
        this.renderEditList();
    },

    renderEditList() {
        const wrap = document.getElementById('tb-editlist');
        wrap.innerHTML = '';
        if (!this.state.tasks.length) {
            const e = document.createElement('div');
            e.className = 'tb-empty';
            e.innerText = 'No tasks yet.';
            wrap.appendChild(e);
            return;
        }
        this.state.tasks.forEach((t, i) => {
            const row = document.createElement('div');
            row.className = 'tb-edit-item' + (t.id === this._editingId ? ' editing' : '');
            row.dataset.id = t.id;
            row.innerHTML = `
                <div class="tb-grip" title="Drag to reorder"></div>
                <div class="tb-item-body">
                    <div class="tb-item-name">${this.esc(t.name)}</div>
                    <div class="tb-item-meta">${t.minutes} min · ${t.mode}${(t.subs && t.subs.length) ? ' · ' + t.subs.length + ' steps' : ''}${t.done ? ' · done' : ''}${t.skipped ? ' · skipped' : ''}${t.note ? ' · note' : ''}</div>
                </div>
                <div class="tb-edit-actions">
                    <button class="tb-edit-btn">Edit</button>
                    <button class="tb-dup-btn" title="Duplicate">Copy</button>
                    <button class="tb-del">Delete</button>
                </div>`;
            row.querySelector('.tb-edit-btn').onclick = () => this.editTask(i);
            row.querySelector('.tb-dup-btn').onclick = () => this.duplicateTask(i);
            row.querySelector('.tb-del').onclick = () => this.deleteTask(i);
            row.querySelector('.tb-grip').addEventListener('pointerdown', (e) => this._dragStart(e));
            wrap.appendChild(row);
        });
    },

    // ---- drag-to-reorder (mouse + touch via pointer events) ----
    // Listeners live on `document` (NOT the row) so reparenting the row mid-drag
    // can't drop a pointer capture and kill the gesture.
    _dragStart(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const row = e.target.closest('.tb-edit-item');
        if (!row) return;
        e.preventDefault();
        const list = document.getElementById('tb-editlist');
        const scroller = list.closest('.scroll-list');
        row.classList.add('dragging');
        if (scroller) scroller.classList.add('tb-noscroll');

        const follow = (clientY) => {
            row.style.transform = 'none';                 // measure at rest
            const box = row.getBoundingClientRect();
            const dy = clientY - (box.top + box.height / 2);
            row.style.transform = `translateY(${dy}px) scale(1.02)`;
        };

        const onMove = (ev) => {
            ev.preventDefault();
            const after = this._dragAfter(list, ev.clientY);
            if (after == null) { if (list.lastElementChild !== row) list.appendChild(row); }
            else if (after !== row) list.insertBefore(row, after);
            follow(ev.clientY);
        };
        const onEnd = () => {
            row.style.transform = '';
            row.classList.remove('dragging');
            if (scroller) scroller.classList.remove('tb-noscroll');
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onEnd);
            document.removeEventListener('pointercancel', onEnd);
            this._commitOrder();
        };
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onEnd);
        document.addEventListener('pointercancel', onEnd);
        follow(e.clientY);
    },

    _dragAfter(list, y) {
        const els = [...list.querySelectorAll('.tb-edit-item:not(.dragging)')];
        let closest = null, closestOffset = -Infinity;
        for (const el of els) {
            const box = el.getBoundingClientRect();
            const offset = y - (box.top + box.height / 2);
            if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
        }
        return closest;
    },

    _commitOrder() {
        const list = document.getElementById('tb-editlist');
        const order = [...list.querySelectorAll('.tb-edit-item')].map(el => parseInt(el.dataset.id, 10));
        const activeId = this.state.activeIndex >= 0 && this.state.tasks[this.state.activeIndex]
            ? this.state.tasks[this.state.activeIndex].id : null;
        this.state.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        this.saveTasks();
        if (activeId != null) this.state.activeIndex = this.state.tasks.findIndex(t => t.id === activeId);
        this.renderEditList();
    },

    // ---- routines (saved task lists) ----
    async saveRoutine() {
        if (!this.state.tasks.length) { await app.alertDialog('Add some tasks first.'); return; }
        const name = await app.promptDialog('Name this routine', '', 'Save Routine');
        if (name == null) return;
        const nm = name.trim();
        if (!nm) return;
        const snapshot = this._snapshot(this.state.tasks);
        const existing = this.state.routines.findIndex(r => r.name.toLowerCase() === nm.toLowerCase());
        if (existing >= 0) this.state.routines[existing] = { name: nm, tasks: snapshot };
        else this.state.routines.push({ name: nm, tasks: snapshot });
        this.saveRoutines();
        this.renderRoutines();
    },
    // strip a task list down to a portable snapshot (no ids / run state)
    _snapshot(tasks) {
        return tasks.map(t => ({
            name: t.name, minutes: t.minutes, mode: t.mode, note: t.note || '',
            subs: (t.subs || []).map(s => ({ text: s.text })),
        }));
    },

    async loadRoutine(index) {
        const r = this.state.routines[index];
        if (!r) return;
        const ok = await app.confirmDialog(`Load “${r.name}”? This replaces your current task list.`, 'Load Routine');
        if (!ok) return;
        this.stopTicking();
        this.state.session = null;
        this.state.tasks = r.tasks.map(x => this._normTask(x));
        this._nextId = this.state.tasks.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        this.saveTasks();
        const i = this.firstUndone();
        if (i >= 0) this.arm(i); else this._clearArm();
        this.renderEditList();
        this.renderCount();
    },

    async deleteRoutine(index) {
        const r = this.state.routines[index];
        if (!r) return;
        const ok = await app.confirmDialog(`Delete routine “${r.name}”?`, 'Delete Routine');
        if (!ok) return;
        this.state.routines.splice(index, 1);
        this.saveRoutines();
        this.renderRoutines();
    },

    renderRoutines() {
        const wrap = document.getElementById('tb-routines');
        if (!wrap) return;
        wrap.innerHTML = '';
        if (!this.state.routines.length) {
            const e = document.createElement('div');
            e.className = 'tb-empty';
            e.innerText = 'No saved routines yet.';
            wrap.appendChild(e);
            return;
        }
        this.state.routines.forEach((r, i) => {
            const mins = r.tasks.reduce((s, t) => s + (parseInt(t.minutes, 10) || 0), 0);
            const row = document.createElement('div');
            row.className = 'tb-routine';
            row.innerHTML = `
                <div class="tb-item-body">
                    <div class="tb-item-name">${this.esc(r.name)}</div>
                    <div class="tb-item-meta">${r.tasks.length} tasks · ${this.fmtDur(mins)}</div>
                </div>
                <div class="tb-edit-actions">
                    <button class="tb-edit-btn">Load</button>
                    <button class="tb-dup-btn">Share</button>
                    <button class="tb-del">Delete</button>
                </div>`;
            row.querySelector('.tb-edit-btn').onclick = () => this.loadRoutine(i);
            row.querySelector('.tb-dup-btn').onclick = () => this.shareRoutine(i);
            row.querySelector('.tb-del').onclick = () => this.deleteRoutine(i);
            wrap.appendChild(row);
        });
    },

    // ---- share a routine via URL ----
    // encode {name,tasks} to a URL-safe base64 payload behind ?r=
    _encodeRoutine(r) {
        const compact = {
            n: r.name,
            t: r.tasks.map(t => ({
                n: t.name, m: t.minutes,
                d: t.mode === 'soft' ? 1 : t.mode === 'break' ? 2 : 0,
                o: t.note || undefined,
                s: (t.subs && t.subs.length) ? t.subs.map(x => x.text) : undefined,
            })),
        };
        const json = JSON.stringify(compact);
        const b64 = btoa(unescape(encodeURIComponent(json)));
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    _decodeRoutine(code) {
        try {
            let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            const json = decodeURIComponent(escape(atob(b64)));
            const c = JSON.parse(json);
            if (!c || !Array.isArray(c.t)) return null;
            const modes = ['hard', 'soft', 'break'];
            return {
                name: String(c.n || 'Shared routine').slice(0, 60),
                tasks: c.t.slice(0, 40).map(t => ({
                    name: String(t.n || 'Task').slice(0, 60),
                    minutes: Math.max(1, Math.min(600, parseInt(t.m, 10) || 25)),
                    mode: modes[t.d] || 'hard',
                    note: String(t.o || ''),
                    subs: Array.isArray(t.s) ? t.s.slice(0, 20).map(x => ({ text: String(x).slice(0, 80) })) : [],
                })),
            };
        } catch (e) { return null; }
    },
    async shareRoutine(index) {
        const r = this.state.routines[index];
        if (!r) return;
        const code = this._encodeRoutine(r);
        const url = `${location.origin}/timebox?r=${code}`;
        let shared = false;
        if (navigator.share) {
            try { await navigator.share({ title: `Timebox routine: ${r.name}`, url }); shared = true; } catch (e) {}
        }
        if (!shared) {
            try { await navigator.clipboard.writeText(url); await app.alertDialog('Share link copied to clipboard.', 'Share Routine'); }
            catch (e) { await app.promptDialog('Copy this link to share:', url, 'Share Routine'); }
        }
    },
    // called on load if a ?r= link is present
    async _maybeImportShared() {
        let code = null;
        try { code = new URLSearchParams(location.search).get('r'); } catch (e) {}
        if (!code) return;
        const r = this._decodeRoutine(code);
        // clean the URL so a refresh doesn't re-prompt
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        if (!r) return;
        const mins = r.tasks.reduce((s, t) => s + t.minutes, 0);
        const ok = await app.confirmDialog(`Import shared routine “${r.name}” (${r.tasks.length} tasks · ${this.fmtDur(mins)})?`, 'Shared Routine');
        if (!ok) return;
        // avoid name clash
        let nm = r.name;
        if (this.state.routines.some(x => x.name.toLowerCase() === nm.toLowerCase())) nm = nm + ' (shared)';
        this.state.routines.push({ name: nm, tasks: this._snapshot(r.tasks.map(x => this._normTask(x))) });
        this.saveRoutines();
        // show the tasks editor so the imported routine is visible in the list
        this.openTasks();
    },

    // ---- session summary ----
    renderSummary(rows) {
        const done = rows.filter(r => r.status === 'done').length;
        const skipped = rows.filter(r => r.status === 'skipped').length;
        const focus = rows.reduce((s, r) => s + r.spent, 0);
        const over = rows.reduce((s, r) => s + r.overtime, 0);
        const head = document.getElementById('tb-sum-head');
        if (head) {
            head.innerHTML =
                `<div class="tb-sum-stat"><b>${done}</b><span>completed</span></div>` +
                `<div class="tb-sum-stat"><b>${skipped}</b><span>skipped</span></div>` +
                `<div class="tb-sum-stat"><b>${this.clock(focus)}</b><span>focus time</span></div>` +
                (over > 30 ? `<div class="tb-sum-stat"><b>${this.clock(over)}</b><span>overtime</span></div>` : '');
        }
        const list = document.getElementById('tb-sum-list');
        if (list) {
            list.innerHTML = '';
            rows.forEach(r => {
                const div = document.createElement('div');
                div.className = 'tb-sum-row ' + r.status;
                const delta = r.spent - r.planned;
                let tag = '';
                if (r.status === 'skipped') tag = 'skipped';
                else if (Math.abs(delta) < 30) tag = 'on time';
                else if (delta > 0) tag = `+${this.clock(delta)}`;
                else tag = `-${this.clock(-delta)}`;
                div.innerHTML = `
                    <div class="tb-item-body">
                        <div class="tb-item-name">${this.esc(r.name)}</div>
                        <div class="tb-item-meta">planned ${this.clock(r.planned)} · actual ${this.clock(r.spent)}</div>
                    </div>
                    <div class="tb-sum-tag">${tag}</div>`;
                list.appendChild(div);
            });
        }
        this.renderStreak();
    },

    // consecutive-day streak from history
    _streak() {
        if (!this.state.history.length) return 0;
        const days = [...new Set(this.state.history.map(h => h.date))].sort();
        let streak = 1;
        for (let i = days.length - 1; i > 0; i--) {
            const a = new Date(days[i] + 'T00:00:00');
            const b = new Date(days[i - 1] + 'T00:00:00');
            const diff = Math.round((a - b) / 86400000);
            if (diff === 1) streak++; else break;
        }
        return streak;
    },
    renderStreak() {
        const el = document.getElementById('tb-sum-streak');
        if (!el) return;
        const s = this._streak();
        const sessions = this.state.history.length;
        el.innerText = s > 1 ? `${s}-day streak · ${sessions} sessions logged` : `${sessions} session${sessions === 1 ? '' : 's'} logged`;
        this.renderChart();
    },

    // ---- weekly focus chart (last 7 days, minutes per day) ----
    renderChart() {
        const wrap = document.getElementById('tb-chart');
        if (!wrap) return;
        // sum focusSec per calendar day
        const byDay = {};
        this.state.history.forEach(h => { byDay[h.date] = (byDay[h.date] || 0) + (h.focusSec || 0); });
        // build the last 7 day keys ending today, using the newest history date as "today"
        const dates = Object.keys(byDay).sort();
        const anchor = dates.length ? new Date(dates[dates.length - 1] + 'T00:00:00') : null;
        if (!anchor) { wrap.innerHTML = '<div class="tb-empty">No focus logged yet.</div>'; return; }
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(anchor.getTime() - i * 86400000);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
            days.push({ key, mins: Math.round((byDay[key] || 0) / 60), label: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()] });
        }
        const max = Math.max(1, ...days.map(d => d.mins));
        wrap.innerHTML = '';
        days.forEach(d => {
            const col = document.createElement('div');
            col.className = 'tb-bar-col';
            const h = d.mins ? Math.max(6, Math.round((d.mins / max) * 100)) : 2;
            col.innerHTML = `
                <div class="tb-bar-val">${d.mins || ''}</div>
                <div class="tb-bar-wrap"><div class="tb-bar${d.mins ? '' : ' empty'}" style="height:${h}%"></div></div>
                <div class="tb-bar-day">${d.label}</div>`;
            wrap.appendChild(col);
        });
    },

    summaryDone() { this.open(); },

    // ---- routine manager (drag tasks between routines) ----
    openManager() {
        this._mgrLeft = this._mgrLeft || 0;
        this._mgrRight = this._mgrRight || (this.state.routines.length > 1 ? 1 : 0);
        if (this._mgrLeft >= this.state.routines.length) this._mgrLeft = 0;
        if (this._mgrRight >= this.state.routines.length) this._mgrRight = Math.max(0, this.state.routines.length - 1);
        this.renderManager();
        app.switchView('view-timebox-manager');
    },
    setMgr(side, index) {
        if (side === 'left') this._mgrLeft = index; else this._mgrRight = index;
        this.renderManager();
    },
    renderManager() {
        const sel = (id, cur, onchange) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.innerHTML = '';
            this.state.routines.forEach((r, i) => {
                const o = document.createElement('option');
                o.value = i; o.textContent = r.name;
                if (i === cur) o.selected = true;
                el.appendChild(o);
            });
        };
        sel('tb-mgr-left-sel', this._mgrLeft);
        sel('tb-mgr-right-sel', this._mgrRight);
        this._renderMgrCol('tb-mgr-left', this._mgrLeft, 'left');
        this._renderMgrCol('tb-mgr-right', this._mgrRight, 'right');
    },
    _renderMgrCol(id, rIndex, side) {
        const wrap = document.getElementById(id);
        if (!wrap) return;
        wrap.innerHTML = '';
        const r = this.state.routines[rIndex];
        if (!r) { wrap.innerHTML = '<div class="tb-empty">No routine.</div>'; return; }
        if (!r.tasks.length) { wrap.innerHTML = '<div class="tb-empty">Empty.</div>'; }
        r.tasks.forEach((t, i) => {
            const row = document.createElement('div');
            row.className = 'tb-mgr-item';
            const dir = side === 'left' ? '→' : '←';
            row.innerHTML = `
                <div class="tb-item-body">
                    <div class="tb-item-name">${this.esc(t.name)}</div>
                    <div class="tb-item-meta">${t.minutes} min · ${t.mode}</div>
                </div>
                <button class="tb-mgr-move" title="Move to other routine">${dir}</button>`;
            row.querySelector('.tb-mgr-move').onclick = () => this.moveTaskBetween(side, i);
            wrap.appendChild(row);
        });
    },
    moveTaskBetween(fromSide, i) {
        const fromIdx = fromSide === 'left' ? this._mgrLeft : this._mgrRight;
        const toIdx = fromSide === 'left' ? this._mgrRight : this._mgrLeft;
        const from = this.state.routines[fromIdx];
        const to = this.state.routines[toIdx];
        if (!from || !to || from === to) return;
        const [task] = from.tasks.splice(i, 1);
        if (task) to.tasks.push(task);
        this.saveRoutines();
        this.renderManager();
        this.renderRoutines();
    },

    // ---- alarm sound (shares pomodoro's ALARMS) ----
    renderSounds() {
        const list = document.getElementById('tb-sounds');
        if (!list) return;
        list.innerHTML = '';
        pomodoro.ALARMS.forEach((a, i) => {
            const div = document.createElement('div');
            div.className = 'sound-item' + (i === this.state.sound ? ' selected' : '');
            div.innerHTML = `
                <div>
                    <div class="s-name">${a.name}</div>
                    <div class="s-sub">${a.desc}</div>
                </div>
                <div class="s-check">&#10003;</div>`;
            div.onclick = () => {
                this.state.sound = i;
                this.saveSound();
                this.renderSounds();
                this.playAlarm(i);
            };
            list.appendChild(div);
        });
    },

    // ---- notifications ----
    requestNotifyPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            try { Notification.requestPermission(); } catch (e) {}
        }
    },
    notify(task, mode) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const body = mode === 'soft'
            ? `“${task.name}” — time's up. Wrap up or add a few minutes.`
            : mode === 'break'
            ? `Break over — back to it.`
            : `“${task.name}” — time's up. Move on.`;
        try { new Notification('Timebox', { body, silent: false }); } catch (e) {}
    },

    // ---- audio (reuse pomodoro's synth) ----
    playAlarm(index) { pomodoro.playAlarm(index); },
    chime() { this.playAlarm(this.state.sound); },
};

timebox.load();

// wire up deep-link routing now that all three timers exist
app.initRouter();

// import a shared routine if the URL carries ?r=
timebox._maybeImportShared();

// ---- Keep the layout sized to the visible viewport (on-screen keyboard aware) ----
// On iOS/Android the software keyboard does NOT shrink the layout viewport, so a
// fixed 100dvh #app would push its Apply/Save buttons underneath the keyboard.
// Mirroring window.visualViewport.height into --app-h makes the flex layout recompute
// to the visible area, and the scrollable .panel keeps every field reachable.
(function () {
    const root = document.documentElement;
    const vv = window.visualViewport;
    function sync() {
        const h = vv ? vv.height : window.innerHeight;
        root.style.setProperty('--app-h', h + 'px');
    }
    sync();
    if (vv) {
        vv.addEventListener('resize', sync);
        vv.addEventListener('scroll', sync);
    }
    window.addEventListener('orientationchange', () => setTimeout(sync, 300));
    // once the keyboard has settled, scroll the focused field into the visible area
    document.addEventListener('focusin', (e) => {
        if (e.target && e.target.matches('input, textarea')) {
            setTimeout(() => {
                sync();
                try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
            }, 300);
        }
    });
})();
