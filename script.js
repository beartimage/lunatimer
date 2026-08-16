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
        presets: readJSON('smartAlarmPresets', DEFAULT_PRESETS)
    },

    // lazily created on first user gesture (avoids autoplay-policy console warnings)
    audioCtx: null,
    _ctx() {
        if (!this.audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) this.audioCtx = new AC();
        }
        return this.audioCtx;
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
        });
    },

    // ---- Navigation ----
    switchView(id) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(id).classList.add('active');
    },
    showTimer()   { if (pomodoro.state.isRunning) pomodoro.pause(); if (timebox.state.isRunning) timebox.pause(); this.switchView('view-timer'); this.updateDisplay(); document.title = 'lunatimer'; },
    showPresets() { this.renderPresets(); this.switchView('view-presets'); },
    showSettings(){ this.renderSounds(); this.switchView('view-settings'); },

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
             : '/'; // welcome / home
    },
    _modeForPath(pathname) {
        const p = (pathname || '/').replace(/\/+$/, '') || '/';
        if (p === '/timer') return 'meditation';
        if (p === '/pomodoro') return 'pomodoro';
        if (p === '/timebox') return 'timebox';
        return 'welcome'; // '/' opens the choose-a-timer welcome screen
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
            // welcome / home — pause everything and show the chooser screen
            if (this.state.isRunning) this.pauseTimer();
            if (pomodoro.state.isRunning) pomodoro.pause();
            if (timebox.state.isRunning) timebox.pause();
            this.switchView('view-welcome');
            document.title = 'lunatimer';
        }
        this._mode = mode;
    },
    // send the user back to the welcome screen
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
        const ctx = this._ctx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        // nothing set yet — send the user to Set Time instead of silently doing nothing
        if (this.state.remainingSeconds <= 0) { this.showTimeSetup(); return; }
        this.state.isRunning = true;
        document.getElementById('app').classList.add('running');
        this.setPlayButton(true);
        this.requestWakeLock();

        // wall-clock end time drives a smooth, accurate ring (Apple-style)
        this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;
        this._firedMarks = new Set();

        this.state.timerId = setInterval(() => {
            const remMs = this.state.endTime - performance.now();
            this.state.remainingSeconds = Math.max(0, Math.ceil(remMs / 1000));

            const elapsed = this.state.durationSeconds - this.state.remainingSeconds;
            this.state.intervalMarks.forEach((m) => {
                if (elapsed >= m && this.state.remainingSeconds > 0 && !this._firedMarks.has(m)) {
                    this._firedMarks.add(m);
                    this.playSound(this.currentSound(), { dur: 1.8, pitch: 1.5 }); // interval: higher & shorter
                }
            });

            if (remMs <= 0) {
                this.pauseTimer();
                this.playSound(this.currentSound());                          // final alarm
                this.switchView('view-complete');
            } else {
                this.updateDisplay();
            }
        }, 250);

        this.updateDisplay();
        this._raf();
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
        document.getElementById('app').classList.remove('running');
        this.setPlayButton(false);
        this.releaseWakeLock();
        this.updateDisplay();
    },

    setPlayButton(running) {
        document.getElementById('play-label').innerText = running ? 'Pause' : 'Start';
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

    // ---- Wake Lock: keep the screen ON while the timer is running ----
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

    // ---- Synthesized bowl sound ----
    playSound(def, opts = {}) {
        const ctx = this._ctx();
        if (!ctx) return;
        const t = ctx.currentTime;
        const dur = opts.dur || def.dur;
        const pitch = opts.pitch || 1;

        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, t);
        master.gain.linearRampToValueAtTime(0.9, t + 0.08);
        master.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        master.connect(ctx.destination);

        def.partials.forEach(p => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(def.base * p.r * pitch, t);
            g.gain.setValueAtTime(p.g, t);
            osc.connect(g);
            g.connect(master);
            osc.start(t);
            osc.stop(t + dur);
        });
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
        const ctx = app._ctx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        this.requestNotifyPermission(); // ask on a real user gesture, not on view-open
        if (this.state.remainingSeconds <= 0) this.arm(this.state.mode);
        this.state.isRunning = true;
        this.setPlayLabel(true);
        document.getElementById('app').classList.add('running');
        app.requestWakeLock();

        // drift-corrected: track an absolute end timestamp, not tick counts
        this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;

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
        this.stopTicking();
        app.releaseWakeLock();
        this.chime();

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

    // ---- play a chosen alarm sequence (used for completion + settings preview) ----
    playAlarm(index) {
        const a = this.ALARMS[index] || this.ALARMS[0];
        const ctx = app._ctx();
        if (!ctx) return;
        if (ctx.state === 'suspended') ctx.resume();
        const t0 = ctx.currentTime;
        a.notes.forEach(n => {
            const start = t0 + n.t;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = a.type || 'sine';
            osc.frequency.setValueAtTime(n.f, start);
            g.gain.setValueAtTime(0.0001, start);
            g.gain.linearRampToValueAtTime(n.g, start + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0006, start + n.d);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(start); osc.stop(start + n.d);
        });
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

    state: {
        tasks: [],           // [{id, name, minutes, mode:'hard'|'soft', done}]
        sound: 0,            // index into pomodoro.ALARMS
        activeIndex: -1,     // task currently armed/running
        remainingSeconds: 0,
        totalSeconds: 0,
        isRunning: false,
        overtime: false,     // soft task ran out, awaiting extend/complete
        endTime: 0,
        timerId: null,
        rafId: null,
    },

    // ---- persistence ----
    load() {
        let t = null, s = null;
        try { t = JSON.parse(localStorage.getItem('timeboxTasks')); } catch (e) {}
        try { s = JSON.parse(localStorage.getItem('timeboxSound')); } catch (e) {}
        if (Array.isArray(t) && t.length) {
            this.state.tasks = t.map(x => ({
                id: x.id, name: String(x.name || 'Task'),
                minutes: Math.max(1, parseInt(x.minutes, 10) || 25),
                mode: x.mode === 'soft' ? 'soft' : 'hard',
                done: !!x.done,
            }));
        } else {
            // sensible starter list
            this.state.tasks = [
                { id: 1, name: 'Plan the day', minutes: 10, mode: 'soft', done: false },
                { id: 2, name: 'Deep work',    minutes: 50, mode: 'hard', done: false },
                { id: 3, name: 'Emails',        minutes: 25, mode: 'hard', done: false },
            ];
        }
        this._nextId = this.state.tasks.reduce((m, x) => Math.max(m, x.id), 0) + 1;
        const si = Number.isFinite(s) ? s : 0;
        this.state.sound = (si >= 0 && si < pomodoro.ALARMS.length) ? si : 0;
    },
    saveTasks() { localStorage.setItem('timeboxTasks', JSON.stringify(this.state.tasks)); },
    saveSound() { localStorage.setItem('timeboxSound', JSON.stringify(this.state.sound)); },

    // ---- helpers ----
    activeTask() { return this.state.tasks[this.state.activeIndex] || null; },
    firstUndone() {
        const i = this.state.tasks.findIndex(t => !t.done);
        return i === -1 ? (this.state.tasks.length ? 0 : -1) : i;
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
        this.stopTicking();
        app.releaseWakeLock();
        this.arm(index);
        document.title = 'lunatimer';
    },

    // ---- controls ----
    toggle() { this.state.isRunning ? this.pause() : this.start(); },

    start() {
        if (!this.activeTask()) { this.openTasks(); return; }
        const ctx = app._ctx();
        if (ctx && ctx.state === 'suspended') ctx.resume();
        this.requestNotifyPermission(); // ask on a real user gesture, not on view-open
        if (this.state.overtime) return; // must extend/complete first
        if (this.state.remainingSeconds <= 0) this.arm(this.state.activeIndex);
        this.state.isRunning = true;
        this.setPlayLabel(true);
        document.getElementById('app').classList.add('running');
        app.requestWakeLock();

        this.state.endTime = performance.now() + this.state.remainingSeconds * 1000;
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
    },

    // Reset: re-arm the current task from full
    reset() {
        app.releaseWakeLock();
        if (this.state.activeIndex >= 0) this.arm(this.state.activeIndex);
        else this.render();
        document.title = 'lunatimer';
    },

    // Next: advance to the following task (does NOT mark current done)
    next() {
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

    // task reached 00:00
    complete() {
        const task = this.activeTask();
        this.stopTicking();
        app.releaseWakeLock();
        this.chime();

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

        // hard: stop immediately, mark done, move on
        this.notify(task, 'hard');
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
        if (task) { task.done = true; this.saveTasks(); }
        const nextIdx = this.firstUndone();
        if (nextIdx >= 0 && this.state.tasks.some(t => !t.done)) {
            this.arm(nextIdx);   // armed, paused — user reviews then starts
        } else {
            // all tasks done
            this._clearArm();
            this.render();
        }
        document.title = 'lunatimer';
    },

    // toggle a task's done state from the list (without running it)
    toggleDone(index) {
        const t = this.state.tasks[index];
        if (!t) return;
        t.done = !t.done;
        this.saveTasks();
        this.renderList();
        this.renderCount();
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
            badge.innerText = task.mode === 'soft' ? 'Soft' : 'Hard';
            badge.className = 'tb-badge ' + task.mode;
        } else {
            badge.style.display = 'none';
        }
        this.updateText();
        this.renderCount();
        this.renderList();
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
        const pos = this.state.activeIndex >= 0 ? `Task ${this.state.activeIndex + 1} of ${n}` : 'All done';
        el.innerText = `${pos} · ${done}/${n} done`;
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
            row.className = 'tb-item' + (i === this.state.activeIndex ? ' active' : '') + (t.done ? ' done' : '');
            row.innerHTML = `
                <div class="tb-check">&#10003;</div>
                <div class="tb-item-body">
                    <div class="tb-item-name">${this.esc(t.name)}</div>
                    <div class="tb-item-meta">${t.minutes} min · ${t.mode}</div>
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
        this.renderEditList();
        this.renderSounds();
        app.switchView('view-timebox-tasks');
    },

    // reset the add/edit form back to its default "add new" state
    _resetForm() {
        const nameEl = document.getElementById('tb-in-name');
        const minEl = document.getElementById('tb-in-min');
        if (nameEl) nameEl.value = '';
        if (minEl) minEl.value = '25';
        document.getElementById('tb-add-btn').innerText = '+ Add Task';
        document.getElementById('tb-cancel-edit').style.display = 'none';
    },

    setAddMode(mode) {
        this._addMode = mode === 'soft' ? 'soft' : 'hard';
        this._applyModeUI();
    },
    _applyModeUI() {
        document.querySelectorAll('#tb-mode-toggle .unit-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === this._addMode);
        });
        document.getElementById('tb-mode-hint').innerText = this._addMode === 'soft'
            ? 'Soft: keep a few extra minutes if you’re close.'
            : 'Hard: stop the moment time runs out.';
    },

    async addTask() {
        const nameEl = document.getElementById('tb-in-name');
        const minEl = document.getElementById('tb-in-min');
        const name = (nameEl.value || '').trim();
        const minutes = Math.max(1, Math.min(600, parseInt(minEl.value, 10) || 0));
        if (!name) { await app.alertDialog('Enter a task name first.'); return; }
        if (!minutes) { await app.alertDialog('Enter a valid number of minutes.'); return; }

        // editing an existing task
        if (this._editingId != null) {
            const t = this.state.tasks.find(x => x.id === this._editingId);
            if (t) {
                t.name = name;
                t.minutes = minutes;
                t.mode = this._addMode;
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
        this.state.tasks.push({ id: this._nextId++, name, minutes, mode: this._addMode, done: false });
        this.saveTasks();
        nameEl.value = '';
        minEl.value = '25';
        // if nothing was armed, arm the new task
        if (this.state.activeIndex < 0) this.arm(this.state.tasks.length - 1);
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
                    <div class="tb-item-meta">${t.minutes} min · ${t.mode}${t.done ? ' · done' : ''}</div>
                </div>
                <div class="tb-edit-actions">
                    <button class="tb-edit-btn">Edit</button>
                    <button class="tb-del">Delete</button>
                </div>`;
            row.querySelector('.tb-edit-btn').onclick = () => this.editTask(i);
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
