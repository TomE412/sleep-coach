// Sleep Coach: a check-in timer for gentle sleep training. Everything is stored on the phone (localStorage).
const APP_VERSION = '1.4.0';
const KEY = 'sleepcoach.v1';

const PROGRAMS = [
  { id: '4-8-12', mins: [4, 8, 12], note: 'The classic. A short first wait that builds up.' },
  { id: '8-8-12-12', mins: [8, 8, 12, 12], note: 'Longer from the start, with four check-ins.' },
  { id: '12-12-12', mins: [12, 12, 12], note: 'Even, steady waits every time.' },
  { id: 'custom', mins: null, note: 'Choose your own minutes.' }
];

// Shown while the parent waits outside the door. {name} is replaced with the baby's name.
const WAITING = [
  'Just breathe. In for four… and out for six.',
  'This hurts right now. Stay strong and wait it out.',
  '{name} is safe, fed and loved. Crying is not harm.',
  'You are not leaving {name}. You are coming back.',
  'Every minute you wait is a minute {name} gets to practise.',
  'Drop your shoulders. Unclench your jaw. Breathe.',
  'Babies cry in waves. A quieter moment is coming.',
  'You did the preparation. Trust it.',
  '{name} is learning that the cot is a safe place.',
  'Giving in now would restart the lesson. Hold steady.',
  'It is okay if you cry too. You are doing something hard and kind.',
  'Sleep is a skill. You are giving {name} the space to learn it.',
  'Nights one and two are the hardest. Each one gets easier.',
  'Have a sip of water. You have got this.',
  'Crying is how {name} talks. Right now it says “this is new”.',
  'You are the calm one tonight. Breathe slowly.',
  'Ten nights from now you may both be sleeping through.',
  'Watch the monitor, not the clock. The timer will tell you when.',
  'Soft hands, soft heart, firm plan.',
  'Think of tomorrow morning: open curtains, big smiles.',
  'A well-rested {name} is a happier {name}. This is for them.',
  'Count five things you can hear. Slow your breathing.',
  'Stay put. You will hear a soft “shhh” when it is time.',
  'You love {name} enough to do the hard thing.',
  'Tears now, rest later. For everyone.'
];

const READY = [
  ['routine', 'A bedtime routine, same time every night', 'Bath, feed, pyjamas, dim lights, cot. Never earlier, never later.'],
  ['drowsy', 'Going down drowsy but awake', 'Practise on one nap first, then the others and bedtime.'],
  ['room', 'The room is ready', 'Dark, white noise on, about 20–22 °C, safe empty cot. Twins: separate cots, far apart.'],
  ['feeds', 'No night feeds for at least 7 nights in a row', 'So you know it is not hunger when they cry. Check with your clinic first.'],
  ['crib', '5–10 nights soothing in the cot', 'Settling them without lifting them out at night.'],
  ['team', 'You and your partner agree on the plan', 'Decide who does the check-ins. It can help if it is not the parent who feeds.'],
  ['ten', 'You are committing to the whole plan', 'Even if it clicks on night 2, keep going every night to the end.']
];

/* ---------- storage ---------- */
function load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
let S = load() || {};
S.nights = S.nights || [];
S.ready = S.ready || {};
if (S.checkinSecs == null) S.checkinSecs = 20;
if (S.sound == null) S.sound = true;
if (S.vibrate == null) S.vibrate = true;
if (S.planNights == null) S.planNights = 21;

/* ---------- helpers ---------- */
const $ = sel => document.querySelector(sel);
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const name = () => (S.baby && S.baby.name) || 'baby';
const fill = s => s.replace(/\{name\}/g, esc(name()));
const mins = () => (S.program && S.program.mins) || [4, 8, 12];
const minsFor = step => mins()[Math.min(step, mins().length - 1)];
const mmss = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const day = t => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
function nightHours() {
  if (!S.baby) return 0;
  let d = toMin(S.baby.wake) - toMin(S.baby.bed);
  if (d <= 0) d += 1440;
  return d / 60;
}
function programLabel(p) { return (p && p.mins ? p.mins : [4, 8, 12]).join(' · ') + ' min'; }
const cryMs = w => (w.asleep || Date.now()) - w.start;
const nightCryMin = n => Math.round(n.wakings.reduce((a, w) => a + cryMs(w), 0) / 60000);
const nightChecks = n => n.wakings.reduce((a, w) => a + w.checks.length, 0);
const liveNight = () => S.live && S.nights[S.live.night];
const liveWaking = () => { const n = liveNight(); return n && n.wakings[n.wakings.length - 1]; };

/* ---------- soft alert: a long, low "shhhhh", plus a buzz where the phone allows it ----------
   iPhones mute Web Audio with the silent switch and freeze the app once the screen locks. So the alert is
   a real audio file played through an <audio> element. During a wait we play ONE track that is silent for
   the length of the wait and then says "shhh" every 10 seconds. Audio keeps playing with the screen locked,
   so the alert goes off on time even while the app itself is frozen. */
// 16 kHz plays cleanly on every phone (Samsungs made 8 kHz sound harsh). Very long tracks drop to 8 kHz to save memory.
const SHH_SECS = 3;
let psstClip = {}, track = null, trackUrl = null, fx = null, fxUrl = null, silentUrl = null, primed = false;
// Standard (RBJ) two-pole filter, used to shape white noise into a soft, low "shh".
function biquad(type, freq, SR) {
  const w = 2 * Math.PI * freq / SR, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const b = type === 'low' ? [(1 - cs) / 2, 1 - cs, (1 - cs) / 2] : [(1 + cs) / 2, -(1 + cs), (1 + cs) / 2];
  const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => {
    const y = (b[0] * x + b[1] * x1 + b[2] * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
function makePsst(SR) {
  if (psstClip[SR]) return psstClip[SR];
  const n = Math.round(SR * SHH_SECS), out = new Float32Array(n);
  const hp = biquad('high', 300, SR), lp1 = biquad('low', 1500, SR), lp2 = biquad('low', 1900, SR);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    // Breathe in over 0.7 s, hold and ease down, breathe out over the last 1.1 s. No clicks.
    const rise = Math.min(1, t / 0.7), fall = Math.min(1, (SHH_SECS - t) / 1.1);
    const env = Math.sin(rise * Math.PI / 2) ** 2 * Math.sin(fall * Math.PI / 2) ** 2 * (1 - 0.15 * t / SHH_SECS)
      * (1 + 0.06 * Math.sin(2 * Math.PI * 1.1 * t));
    out[i] = lp2(lp1(hp(Math.random() * 2 - 1))) * env;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  for (let i = 0; i < n; i++) out[i] = out[i] / peak * 0.6;   // calm, not loud
  return (psstClip[SR] = out);
}
// 16-bit mono WAV: silence, with a shh every 10 s from alarmAt (seconds) to the end.
function wav(totalSec, alarmAt) {
  const SR = totalSec > 1200 ? 8000 : 16000;
  const n = Math.ceil(totalSec * SR), b = new Uint8Array(44 + n * 2), v = new DataView(b.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  if (alarmAt != null) {
    const c = makePsst(SR);
    for (let t = alarmAt; t < totalSec; t += 10) {
      const o = Math.round(t * SR);
      for (let i = 0; i < c.length && o + i < n; i++) v.setInt16(44 + (o + i) * 2, Math.max(-32767, Math.min(32767, Math.round(c[i] * 30000))), true);
    }
  }
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}
const newAudio = () => { const a = new Audio(); a.preload = 'auto'; a.setAttribute('playsinline', ''); return a; };
// Called on every tap. The first tap "unlocks" both players so they may play later without a tap.
function unlockAudio() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  if (primed) return;
  primed = true;
  try {
    track = track || newAudio(); fx = fx || newAudio();
    fxUrl = fxUrl || wav(SHH_SECS + 0.2, 0); silentUrl = silentUrl || wav(0.2, null);
    for (const a of [track, fx]) {
      if (a.src) continue;
      a.src = silentUrl;
      // If a real sound replaced the silent one before this settled, leave the real one alone.
      a.play().then(() => { if (a.src === silentUrl) a.pause(); })
        .catch(() => { if (a.src === silentUrl) { primed = false; a.removeAttribute('src'); } });
    }
  } catch (e) { primed = false; }
}
const trackPlaying = () => !!(track && trackUrl && track.src === trackUrl && !track.paused && !track.ended);
function psst() {
  if (S.sound) {
    try { unlockAudio(); if (fx.src !== fxUrl) fx.src = fxUrl; fx.currentTime = 0; fx.play().catch(() => {}); } catch (e) {}
  }
  buzz();
}
function buzz() { if (S.vibrate && navigator.vibrate) navigator.vibrate([160, 120, 160]); }
function startTrack(waitMs, label) {
  if (!S.sound) return;
  try {
    unlockAudio();
    const old = trackUrl, sec = Math.max(1, waitMs / 1000);
    trackUrl = wav(sec + 120, sec);           // the wait, then 2 minutes of gentle reminders
    track.src = trackUrl; track.currentTime = 0;
    track.play().catch(() => {});
    if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({
      title: label, artist: 'Sleep Coach', artwork: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
    });
  } catch (e) {}
}
function stopTrack() { try { if (track) track.pause(); } catch (e) {} }

/* ---------- keep the screen awake during a session ---------- */
let lock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !lock && document.visibilityState === 'visible') {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    }
  } catch (e) {}
}
function letSleep() { try { lock && lock.release(); } catch (e) {} lock = null; }

function notify(title, body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !navigator.serviceWorker) return;
    navigator.serviceWorker.ready.then(r => r.showNotification(title, {
      body, tag: 'checkin', renotify: true, vibrate: [160, 120, 160], icon: 'icon-192.png', badge: 'icon-192.png'
    }));
  } catch (e) {}
}

/* ---------- session actions ---------- */
function startNight() {
  unlockAudio(); keepAwake();
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
  S.nights.push({ started: Date.now(), ended: null, program: mins().slice(), wakings: [] });
  S.live = { night: S.nights.length - 1 };
  beginWaking();
}
function beginWaking() {
  liveNight().wakings.push({ start: Date.now(), asleep: null, pickedUp: false, checks: [] });
  S.live.step = 0;
  startWait();
}
function startWait() {
  unlockAudio(); keepAwake();
  S.live.phase = 'wait';
  S.live.from = Date.now();
  S.live.ends = Date.now() + minsFor(S.live.step) * 60000;
  startTrack(S.live.ends - Date.now(), 'Next check-in at ' + clock(S.live.ends));
  save(); render();
}
function fireAlarm() {
  S.live.phase = 'alarm'; S.live.from = Date.now(); save();
  trackPlaying() ? buzz() : psst(); lastPsst = Date.now();
  if (document.visibilityState !== 'visible') notify('Time to check on ' + name(), 'Go in for a short, calm check-in.');
  render();
}
function goIn() { unlockAudio(); stopTrack(); S.live.toldOut = false; S.live.phase = 'checkin'; S.live.from = Date.now(); save(); render(); }
function leftRoom() {
  liveWaking().checks.push(Math.round((Date.now() - S.live.from) / 1000));
  S.live.phase = S.live.step >= mins().length - 1 ? 'final' : 'ready';
  if (S.live.phase === 'ready') S.live.step++;
  save(); render();
}
function anotherRound() { S.live.step++; startWait(); }
function fellAsleep(pickedUp) {
  stopTrack();
  const w = liveWaking(); w.asleep = Date.now(); w.pickedUp = !!pickedUp;
  S.live.phase = pickedUp ? 'picked' : 'asleep'; save(); render();
}
function finishNight() {
  stopTrack();
  const n = liveNight(); n.ended = Date.now();
  const w = liveWaking(); if (w && !w.asleep) w.asleep = Date.now();
  S.live = null; save(); letSleep();
  go('morning', S.nights.length - 1);
}

/* ---------- screens ---------- */
let screen = 'home', screenArg = null;
function go(s, arg) { screen = s; screenArg = arg; render(); window.scrollTo(0, 0); }

function render() {
  clearInterval(rotateTimer); rotateTimer = null;
  const v = $('#view');
  if (!S.baby) return setupScreen(v);
  if (!S.program) return programScreen(v, true);
  if (S.live) return sessionScreen(v);
  ({ home: homeScreen, program: programScreen, setup: setupScreen, progress: progressScreen,
     ready: readyScreen, settings: settingsScreen, morning: morningScreen, report: reportScreen }[screen] || homeScreen)(v, false);
}

function header(title, back = 'home') {
  return `<div class="top"><button class="icon-btn" data-go="${back}" aria-label="Back">‹</button><h1>${title}</h1></div>`;
}
function bindGo(v) { v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go)); }

function setupScreen(v) {
  const b = S.baby || { name: '', bed: '19:00', wake: '06:00' };
  const first = !S.baby;
  v.innerHTML = `
    ${first ? `<img class="scene" src="scene.jpg" alt=""><div class="hero over"><h1>Sleep Coach</h1>
      <p class="muted">A gentle timer for check-ins, and a friend while you wait.</p></div>` : header('Baby details', 'settings')}
    <div class="card">
      <label for="nm">Baby's name</label>
      <input id="nm" type="text" autocomplete="off" placeholder="e.g. Ella" value="${esc(b.name)}">
      <div class="row">
        <div><label for="bed">Bedtime</label><input id="bed" type="time" value="${b.bed}"></div>
        <div><label for="wk">Awake time</label><input id="wk" type="time" value="${b.wake}"></div>
      </div>
      <p class="small muted" id="hrs"></p>
    </div>
    <button class="btn primary big" id="next">${first ? 'Next: choose a program' : 'Save'}</button>`;
  const hrs = () => {
    const bed = $('#bed').value, wake = $('#wk').value;
    if (!bed || !wake) return;
    let d = toMin(wake) - toMin(bed); if (d <= 0) d += 1440;
    $('#hrs').innerHTML = d / 60 < 11
      ? `<span class="warn">That is ${(d / 60).toFixed(1)} hours. The method aims for 11+ hours in the cot.</span>`
      : `${(d / 60).toFixed(1)} hours in the cot. Bedtime stays the same every night.`;
  };
  $('#bed').oninput = $('#wk').oninput = hrs; hrs();
  $('#next').onclick = () => {
    const n = $('#nm').value.trim();
    if (!n) { $('#nm').focus(); $('#nm').placeholder = 'Please type a name'; return; }
    S.baby = { name: n, bed: $('#bed').value || '19:00', wake: $('#wk').value || '06:00' };
    save(); go(first ? 'program' : 'settings');
  };
  if (!first) bindGo(v);
}

function programScreen(v, first) {
  let pick = (S.program && S.program.id) || '4-8-12';
  let custom = (S.program && S.program.id === 'custom' ? S.program.mins : [5, 10, 15]).join(', ');
  const draw = () => {
    v.innerHTML = `
      ${first ? `<h1>Choose a program</h1><p class="muted">How long you wait outside before each check-in.
        After the last one, if ${esc(name())} is still crying, you can pick them up.</p>` : header('Program', 'settings')}
      ${PROGRAMS.map(p => `<button class="choice ${p.id === pick ? 'on' : ''}" data-p="${p.id}">
        <b>${p.mins ? p.mins.join(' · ') + ' min' : 'Custom'}</b><span>${p.note}</span></button>`).join('')}
      ${pick === 'custom' ? `<div class="card"><label for="cu">Minutes for each wait, separated by commas</label>
        <input id="cu" type="text" inputmode="numeric" value="${esc(custom)}"><p class="small muted">Up to 8 waits, 1–60 minutes each.</p></div>` : ''}
      <div class="card">
        <label for="cs">Check-in length: <b id="csv">${S.checkinSecs}</b> seconds</label>
        <input id="cs" class="slider" type="range" min="10" max="30" step="5" value="${S.checkinSecs}">
        <p class="small muted">Short and sweet. Lingering can upset them more. The timer shows you when you've reached it.</p>
      </div>
      <button class="btn primary big" id="ok">${first ? 'Done' : 'Save'}</button>`;
    v.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { if ($('#cu')) custom = $('#cu').value; pick = b.dataset.p; draw(); });
    $('#cs').oninput = e => { S.checkinSecs = +e.target.value; $('#csv').textContent = S.checkinSecs; };
    $('#ok').onclick = () => {
      let m;
      if (pick === 'custom') {
        m = $('#cu').value.split(/[^0-9.]+/).map(Number).filter(x => x >= 1 && x <= 60).slice(0, 8);
        if (!m.length) { $('#cu').focus(); return; }
      } else m = PROGRAMS.find(p => p.id === pick).mins;
      S.program = { id: pick, mins: m };
      save(); go(first ? 'home' : 'settings');
    };
    if (!first) bindGo(v);
  };
  draw();
}

function homeScreen(v) {
  const n = S.nights.length + 1;
  const done = READY.filter(r => S.ready[r[0]]).length;
  const hours = nightHours();
  if (S.finished) {
    v.innerHTML = `
      <img class="scene" src="scene.jpg" alt="A child plays a flute to a smiling moon and stars">
      <div class="hero over"><h1>The plan is finished</h1>
        <p class="muted">${S.nights.length} nights with ${esc(name())}. Well done, both of you.</p></div>
      <button class="btn primary big" data-go="report">See the final report</button>
      <button class="btn" id="again">Start a new plan</button>
      <div class="links"><button data-go="progress"><span>📈</span>Progress</button>
        <button data-go="ready"><span>✅</span>Checklist</button><button data-go="settings"><span>⚙️</span>Settings</button></div>`;
    $('#again').onclick = newPlan;
    return bindGo(v);
  }
  const planDone = n > planLen();
  v.innerHTML = `
    <img class="scene" src="scene.jpg" alt="A child plays a flute to a smiling moon and stars">
    <div class="hero over">
      <h1>Tonight is night ${n}${planDone ? '' : ' of ' + planLen()}</h1>
      <p class="muted">for ${esc(name())}</p>
      <div class="chips">
        <span class="chip">Bed <b>${S.baby.bed}</b></span>
        <span class="chip">Awake <b>${S.baby.wake}</b></span>
        <span class="chip"><b>${programLabel(S.program)}</b></span>
      </div>
      ${hours < 11 ? `<p class="warn">Bed to awake is ${hours.toFixed(1)} hours. Aim for 11+.</p>` : ''}
    </div>
    <div class="tip"><b>Put ${esc(name())} down drowsy but awake</b>, a pat, dummy if used, and leave.
      Press the button as you walk out. The first wait is ${minsFor(0)} minutes.</div>
    ${planDone ? `<div class="tip"><b>You've reached the end of your ${planLen()}-night plan.</b> Have a look at the report,
      or keep tracking if you'd like.</div><button class="btn calm" data-go="report">See the report</button>` : ''}
    <button class="btn primary big" id="start">Start bedtime</button>
    <div class="links">
      <button data-go="ready"><span>✅</span>Ready? ${done}/${READY.length}</button>
      <button data-go="progress"><span>📈</span>Progress</button>
      <button data-go="settings"><span>⚙️</span>Settings</button>
    </div>
    <p class="small muted center" style="margin-top:22px">Keep the volume up. You can lock the screen while you wait: the shhh still plays.<br>
      Try <b>Settings › Test with the screen locked</b> once first.</p>`;
  $('#start').onclick = startNight;
  bindGo(v);
}

let rotateTimer = null, lastPsst = 0;
function startRotation() {
  const el = $('#enc'); if (!el) return;
  let last = -1;
  const next = () => {
    let i; do { i = Math.floor(Math.random() * WAITING.length); } while (i === last && WAITING.length > 1);
    last = i;
    el.classList.add('fade');
    setTimeout(() => { el.innerHTML = fill(WAITING[i]); el.classList.remove('fade'); }, 600);
  };
  el.innerHTML = fill(WAITING[Math.floor(Math.random() * WAITING.length)]);
  rotateTimer = setInterval(next, 15000);
}

function dotsHtml() {
  const w = liveWaking(), total = Math.max(mins().length, w.checks.length + (S.live.phase === 'wait' || S.live.phase === 'alarm' || S.live.phase === 'checkin' ? 1 : 0));
  let h = '';
  for (let i = 0; i < total; i++) h += `<span class="dot ${i < w.checks.length ? 'done' : i === w.checks.length ? 'now' : ''}"></span>`;
  return `<div class="dots" aria-label="${w.checks.length} check-ins so far">${h}</div>`;
}
const RING = 2 * Math.PI * 45;
const ring = cls => `<div class="ring ${cls}"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="45"/>
  <circle class="bar" id="bar" cx="50" cy="50" r="45" stroke-dasharray="${RING}" stroke-dashoffset="0"/></svg>
  <div class="ring-text"><div class="clock" id="clk">--:--</div><div class="clock-sub" id="clksub"></div></div></div>`;

function sessionScreen(v) {
  const L = S.live, n = L.night + 1, w = liveWaking(), last = mins().length - 1;
  const wakeNo = liveNight().wakings.length;
  const head = `<div class="top"><h1 class="small muted" style="font-size:0.95rem;font-weight:500">Night ${n} · ${wakeNo > 1 ? 'Waking ' + (wakeNo - 1) : 'Bedtime'}</h1>
    <button class="icon-btn" id="menu" aria-label="Finish night">✕</button></div>`;
  const supportive = n <= 2;
  const checkTip = supportive
    ? `<b>Nights 1–2: extra reassurance.</b> Lay them back down, dummy in, a quick pat or back rub, and soft words: “I'm right here, you're okay.” Then out and close the door.`
    : `<b>From night 3: quieter.</b> Reposition, dummy in, a quick pat. No chatting. In and out.`;
  let body = '';

  if (L.phase === 'wait') {
    const finalWait = L.step >= last;
    body = `<div class="stage">
      <div class="step-label">${L.step > last ? 'Extra wait' : 'Wait ' + (L.step + 1) + ' of ' + mins().length} · ${minsFor(L.step)} min</div>
      ${dotsHtml()}${ring('')}
      <div class="encourage" id="enc"></div></div>
      <div class="actions">
        ${finalWait ? `<p class="small muted center">This is the last wait. After this check-in you can pick ${esc(name())} up if they're still crying.</p>` : ''}
        <button class="btn good" id="asleep">${esc(name())} is asleep 💤</button>
      </div>`;
  } else if (L.phase === 'alarm') {
    body = `<div class="stage alarm">
      <div class="pulse" aria-hidden="true"></div>
      <h1>Time to check on ${esc(name())}</h1>
      <p class="muted">If you can, go in during a calmer moment of the cry. It settles them better.</p>
      <p class="small muted" id="late"></p></div>
      <div class="actions">
        <button class="btn calm big" id="goin">Going in</button>
        <button class="btn good" id="asleep">Actually, ${esc(name())} fell asleep</button>
      </div>`;
  } else if (L.phase === 'checkin') {
    body = `<div class="stage">
      <div class="step-label">Check-in ${w.checks.length + 1} · aim for ${S.checkinSecs} sec</div>
      ${ring('checkin')}
      <div class="tip">${checkTip}</div></div>
      <div class="actions"><button class="btn primary big" id="out">I'm out of the room</button></div>`;
  } else if (L.phase === 'ready') {
    body = `<div class="stage">
      <div class="moon">🚪</div>
      <h1>Well done.</h1>
      <p class="muted">Next wait: <b>${minsFor(L.step)} minutes</b>.<br>Start it as soon as the door is closed.</p>
      ${dotsHtml()}</div>
      <div class="actions">
        <button class="btn primary big" id="next">Start ${minsFor(L.step)} min</button>
        <button class="btn good" id="asleep">${esc(name())} is asleep 💤</button>
      </div>`;
  } else if (L.phase === 'final') {
    body = `<div class="stage">
      <div class="moon">💛</div>
      <h1>That was the last check-in.</h1>
      <p class="muted">If ${esc(name())} is still crying, you can pick them up now. Or, if you feel able, do one more ${minsFor(last)}-minute wait.</p>
      ${dotsHtml()}</div>
      <div class="actions">
        <button class="btn calm big" id="pick">I'm picking ${esc(name())} up</button>
        <button class="btn" id="again">One more ${minsFor(last)} min wait</button>
        <button class="btn good" id="asleep">${esc(name())} is asleep 💤</button>
      </div>`;
  } else if (L.phase === 'asleep' || L.phase === 'picked') {
    const cm = Math.round(cryMs(w) / 60000);
    const morning = isMorning();
    body = `<div class="stage">
      <img class="moon-img" src="icon-192.png" alt="">
      <h1>${L.phase === 'asleep' ? esc(name()) + ' is asleep.' : 'You did your best tonight.'}</h1>
      <p class="muted">${L.phase === 'asleep'
        ? `Crying took about ${cm} min with ${w.checks.length} check-in${w.checks.length === 1 ? '' : 's'}. Go and rest.`
        : `Settle ${esc(name())}, then lay them back down drowsy but awake. Tomorrow is a new night.`}</p>
      <div class="since"><div class="clock" id="since">0m</div><div class="clock-sub" id="sincesub">asleep since ${clock(w.asleep)}</div></div>
      ${liveNight().wakings.length > 1 ? `<p class="small muted">Wakings tonight: ${liveNight().wakings.length - 1}</p>` : ''}
      ${morning ? `<p class="warn">It's past ${S.baby.wake}. Good morning! Finish the night below.</p>` : ''}</div>
      <div class="actions">
        <button class="btn calm big" id="woke">${esc(name())} woke up</button>
        <button class="btn ${morning ? 'primary' : ''}" id="finish">It's morning, finish the night</button>
      </div>`;
  }
  v.innerHTML = `<div class="backdrop"></div><div class="session">${head}${body}</div>`;

  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  on('asleep', () => fellAsleep(false));
  on('goin', goIn);
  on('out', leftRoom);
  on('next', startWait);
  on('again', anotherRound);
  on('pick', () => fellAsleep(true));
  on('woke', beginWaking);
  on('finish', finishNight);
  on('menu', () => { if (confirm('Finish tonight now? The night so far is kept in Progress.')) finishNight(); });
  if (L.phase === 'wait') startRotation();
  tick();
}

function isMorning() {
  const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
  const wake = toMin(S.baby.wake);
  return m >= wake && m < wake + 6 * 60;
}

/* Runs four times a second. Works from timestamps, so it catches up if the phone slept. */
function tick() {
  const L = S.live; if (!L) return;
  const now = Date.now();
  if (L.phase === 'wait') {
    if (now >= L.ends) return fireAlarm();
    const total = L.ends - L.from, left = L.ends - now;
    const clk = $('#clk'); if (clk) clk.textContent = mmss(left);
    const sub = $('#clksub'); if (sub) sub.textContent = 'until check-in';
    const bar = $('#bar'); if (bar) bar.setAttribute('stroke-dashoffset', RING * (1 - left / total));
  } else if (L.phase === 'alarm') {
    // Repeat the soft shhh every 10 seconds until the parent taps "Going in".
    if (now - lastPsst > 10000) { trackPlaying() ? buzz() : psst(); lastPsst = now; }
    const late = $('#late'); const s = Math.floor((now - L.from) / 1000);
    if (late) late.textContent = s >= 5 ? `Alert went off ${mmss(s * 1000)} ago` : '';
  } else if (L.phase === 'checkin') {
    const secs = (now - L.from) / 1000, target = S.checkinSecs;
    const clk = $('#clk'); if (clk) clk.textContent = Math.floor(secs) + 's';
    const sub = $('#clksub'); if (sub) sub.textContent = secs >= target ? 'time to leave' : 'in the room';
    const bar = $('#bar'); if (bar) bar.setAttribute('stroke-dashoffset', RING * (1 - Math.min(1, secs / target)));
    if (secs >= target && !L.toldOut) { L.toldOut = true; if (S.vibrate && navigator.vibrate) navigator.vibrate(80); }
  } else if (L.phase === 'asleep' || L.phase === 'picked') {
    const w = liveWaking(), el = $('#since');
    if (el && w.asleep) el.textContent = hm((now - w.asleep) / 60000).replace(' min', 'm');
  }
}
setInterval(tick, 250);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.live) { keepAwake(); unlockAudio(); tick(); }
});
// Audio can only start after a tap, so wake it on every tap.
document.addEventListener('pointerdown', unlockAudio, { passive: true });

function morningScreen(v, _f) {
  const n = S.nights[screenArg];
  if (!n) return go('home');
  const s = stats(n), ns = doneNights();
  v.innerHTML = `
    <div class="hero"><div class="moon">☀️</div><h1>Good morning!</h1>
      <p class="muted">Night ${screenArg + 1} of ${planLen()} is done. ${s.through ? `⭐ ${esc(name())} slept through!` : 'Be proud of yourselves.'}</p></div>
    <div class="card">
      <div class="chips">
        <span class="chip">Settled in <b>${hm(s.settle)}</b></span>
        <span class="chip">Wakings <b>${s.wakings}</b></span>
        <span class="chip">Awake <b>${hm(s.awake)}</b></span>
        <span class="chip">Longest sleep <b>${hm(s.longest * 60)}</b></span>
      </div>
      ${ns.length >= 2 ? `${trendChart(METRICS[0], ns)}<p class="small">${trendWords(METRICS[0], ns)}</p>` : ''}
    </div>
    <div class="tip"><b>Make the morning bright.</b> If ${esc(name())} is crying, wait for a calmer moment before you go in,
      so crying doesn't become the way out of the cot. Then open the curtains, sing, get some fresh air. Morning is fun; night is for sleep.</div>
    <button class="btn primary big" data-go="home">Done</button>
    <button class="btn ghost" data-go="progress">See progress</button>`;
  bindGo(v);
}

/* ---------- tracking: per-night numbers, trend lines, the awake-window map and the report ---------- */
const METRICS = [
  { k: 'awake', label: 'Awake time', short: 'Awake', unit: 'min', better: 'down', fmt: v => Math.round(v) + ' min' },
  { k: 'wakings', label: 'Night wakings', short: 'Wakings', unit: '', better: 'down', fmt: v => (Math.round(v * 10) / 10) + '' },
  { k: 'settle', label: 'Settling at bedtime', short: 'Settling', unit: 'min', better: 'down', fmt: v => Math.round(v) + ' min' },
  { k: 'longest', label: 'Longest sleep', short: 'Longest', unit: 'h', better: 'up', fmt: v => hm(v * 60) }
];
const hm = m => { m = Math.round(m); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
const doneNights = () => S.nights.filter(n => n.ended);
const planLen = () => S.planNights || 21;

function stats(n) {
  const ws = n.wakings, end = n.ended || Date.now();
  const bed = ws[0];
  let longest = 0;
  ws.forEach((w, i) => {
    if (!w.asleep) return;
    const to = ws[i + 1] ? ws[i + 1].start : end;
    longest = Math.max(longest, to - w.asleep);
  });
  const wakings = Math.max(0, ws.length - 1);
  const pickedUp = ws.some(w => w.pickedUp);
  return {
    awake: ws.reduce((a, w) => a + ((w.asleep || end) - w.start), 0) / 60000,
    wakings,
    settle: bed ? ((bed.asleep || end) - bed.start) / 60000 : 0,
    longest: longest / 3600000,
    checks: nightChecks(n),
    through: wakings === 0 && !pickedUp,
    pickedUp
  };
}

// Straight line of best fit through the nightly values.
function fitLine(pts) {
  if (pts.length < 2) return null;
  const n = pts.length, mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, den = 0;
  pts.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2; });
  const slope = den ? num / den : 0;
  return { slope, at: x => my + slope * (x - mx) };
}
function niceMax(v, unit) {
  if (unit === 'h') return Math.max(2, Math.ceil(v / 2) * 2);
  if (v <= 4) return Math.max(1, Math.ceil(v));
  if (v <= 60) return Math.ceil(v / 10) * 10;
  return Math.ceil(v / 30) * 30;
}

function trendChart(metric, ns) {
  const pts = ns.map((n, i) => ({ x: i + 1, y: stats(n)[metric.k] }));
  const slots = Math.max(planLen(), pts.length);
  const W = 340, H = 180, L = 34, R = 8, T = 12, B = 26, pw = W - L - R, ph = H - T - B;
  const max = niceMax(Math.max(0, ...pts.map(p => p.y)), metric.unit);
  const x = i => L + (i - 0.5) / slots * pw, y = v => T + ph - Math.min(v, max) / max * ph;
  const bw = Math.max(3, Math.min(14, pw / slots * 0.62));
  const lab = v => metric.unit === 'h' ? v + 'h' : v + '';
  let g = '';
  for (const v of [0, max / 2, max]) {
    g += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="ch-txt" x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${lab(Math.round(v * 10) / 10)}</text>`;
  }
  for (let i = 1; i <= slots; i++) {
    const p = pts[i - 1];
    if (p) g += `<rect class="ch-bar" x="${x(i) - bw / 2}" y="${y(p.y)}" width="${bw}" height="${Math.max(1.5, T + ph - y(p.y))}" rx="2"><title>Night ${i}: ${metric.fmt(p.y)}</title></rect>`;
    else g += `<circle class="ch-todo" cx="${x(i)}" cy="${T + ph - 2}" r="1.6"/>`;
    if (i === 1 || i % 7 === 0 || i === slots) g += `<text class="ch-txt" x="${x(i)}" y="${H - 8}" text-anchor="middle">${i}</text>`;
  }
  const f = fitLine(pts);
  if (f) {
    const x1 = 1, x2 = pts.length;
    g += `<line class="ch-trend" x1="${x(x1)}" y1="${y(Math.max(0, f.at(x1)))}" x2="${x(x2)}" y2="${y(Math.max(0, f.at(x2)))}"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric.label} per night with trend line">${g}</svg>`;
}

function trendWords(metric, ns) {
  const f = fitLine(ns.map((n, i) => ({ x: i + 1, y: stats(n)[metric.k] })));
  if (!f) return 'The trend line appears after 2 nights.';
  const per = metric.k === 'longest' ? f.slope * 60 : f.slope;   // longest: minutes per night
  const size = Math.abs(per);
  const unit = metric.k === 'wakings' ? 'wakings' : 'min';
  if (size < (metric.k === 'wakings' ? 0.05 : 0.5)) return 'Holding steady.';
  const good = (per < 0) === (metric.better === 'down');
  const amt = metric.k === 'wakings' ? (Math.round(size * 10) / 10) + ' ' + unit : Math.round(size) + ' ' + unit;
  return `${good ? '👍 ' : ''}${per < 0 ? 'Going down' : 'Going up'} by about ${amt} a night${good ? '' : ' (not the way we want yet)'}.`;
}

// One row per night, from just before bedtime to after awake time. Gold = awake, blue = asleep.
function sleepMap(ns, first) {
  if (!ns.length) return '';
  const bedMin = toMin(S.baby.bed), spanMin = nightHours() * 60 + 90;
  const W = 340, L = 26, R = 6, T = 18, rowH = 10, gap = 4, pw = W - L - R;
  const H = T + ns.length * (rowH + gap) + 4;
  const X = (t, b) => L + Math.max(0, Math.min(1, (t - b) / (spanMin * 60000))) * pw;
  let g = '';
  const tick = (min, text) => {
    const px = L + min / spanMin * pw;
    g += `<line class="ch-grid" x1="${px}" x2="${px}" y1="${T - 4}" y2="${H}"/><text class="ch-txt" x="${px}" y="${T - 7}" text-anchor="middle">${text}</text>`;
  };
  tick(30, S.baby.bed);
  const toMidnight = 1440 - (bedMin - 30);
  if (toMidnight > 60 && toMidnight < spanMin - 60) tick(toMidnight, '00:00');
  tick(30 + nightHours() * 60, S.baby.wake);
  ns.forEach((n, r) => {
    const d = new Date(n.started); d.setHours(0, 0, 0, 0);
    let b = d.getTime() + (bedMin - 30) * 60000;
    if (n.started - b < -12 * 3600000) b -= 86400000;   // started after midnight: belongs to the night before
    const yy = T + r * (rowH + gap), end = n.ended || Date.now();
    g += `<text class="ch-txt" x="${L - 5}" y="${yy + rowH - 1.5}" text-anchor="end">${first + r}</text>`;
    g += `<rect class="ch-row" x="${L}" y="${yy}" width="${pw}" height="${rowH}" rx="3"/>`;
    n.wakings.forEach((w, i) => {
      if (w.asleep) {
        const to = n.wakings[i + 1] ? n.wakings[i + 1].start : end;
        g += `<rect class="ch-sleep" x="${X(w.asleep, b)}" y="${yy}" width="${Math.max(0, X(to, b) - X(w.asleep, b))}" height="${rowH}" rx="2"/>`;
      }
      const a = X(w.start, b), z = X(w.asleep || end, b);
      g += `<rect class="${w.pickedUp ? 'ch-picked' : 'ch-awake'}" x="${a}" y="${yy}" width="${Math.max(2, z - a)}" height="${rowH}" rx="2"><title>Awake ${clock(w.start)} for ${hm(((w.asleep || end) - w.start) / 60000)}</title></rect>`;
    });
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Awake and asleep times for each night">${g}</svg>
    <div class="legend"><span><i class="sw ch-sleep"></i>Asleep</span><span><i class="sw ch-awake"></i>Awake / crying</span><span><i class="sw ch-picked"></i>Picked up</span></div>`;
}

let progMetric = 'awake', showAll = false;
function progressScreen(v) {
  const ns = doneNights();
  const live = S.nights.filter(n => !n.ended).length;
  const m = METRICS.find(x => x.k === progMetric);
  const last = ns[ns.length - 1], ls = last && stats(last);
  const through = ns.filter(n => stats(n).through).length;
  v.innerHTML = `${header('Progress')}
    ${ns.length ? `
    <div class="chips">
      <span class="chip">Night <b>${ns.length}</b> of ${planLen()}</span>
      <span class="chip">Slept through <b>${through}</b></span>
    </div>
    <div class="card">
      <div class="seg">${METRICS.map(x => `<button data-m="${x.k}" class="${x.k === progMetric ? 'on' : ''}">${x.short}</button>`).join('')}</div>
      <h2>${m.label} each night</h2>
      ${trendChart(m, ns)}
      <p class="small"><span class="key-trend"></span> ${trendWords(m, ns)}</p>
      ${ls ? `<p class="small muted">Last night: ${m.fmt(ls[m.k])}</p>` : ''}
    </div>
    <div class="card">
      <h2>Awake windows</h2>
      <p class="small muted">Each row is a night. Watch the gold shrink as ${esc(name())} learns.</p>
      ${sleepMap(ns.slice(-planLen()), Math.max(1, ns.length - planLen() + 1))}
    </div>
    <button class="btn primary" id="rep">Get my report</button>
    <h2>Night by night</h2><div class="card">${ns.map((n, i) => ({ n, i })).reverse().slice(0, showAll ? undefined : 5).map(({ n, i }) => { const s = stats(n); return `<div class="night">
        <h3>Night ${i + 1} · ${day(n.started)}${s.through ? ' · ⭐ slept through' : ''}</h3>
        <div class="small muted">Down ${clock(n.started)} · settled in ${hm(s.settle)} · ${s.wakings} waking${s.wakings === 1 ? '' : 's'} · awake ${hm(s.awake)} · longest sleep ${hm(s.longest * 60)}</div>
        ${n.wakings.map((w, j) => `<div class="waking"><span style="min-width:74px">${j ? 'Waking ' + j : 'Bedtime'} ${clock(w.start)}</span>
          <span class="dots">${w.checks.map(() => '<span class="dot done"></span>').join('') || '<span class="small">no check-ins</span>'}</span>
          <span>${Math.round(cryMs(w) / 60000)} min${w.pickedUp ? ' · picked up' : ''}</span></div>`).join('')}
      </div>`; }).join('')}</div>${ns.length > 5 ? `<button class="btn ghost" id="all">${showAll ? 'Show fewer' : 'Show all ' + ns.length + ' nights'}</button>` : ''}`
    : `<div class="card center"><p>No finished nights yet${live ? ' (tonight is still going)' : ''}.</p>
        <p class="muted small">After each night you'll see a trend line for awake time, wakings, settling and the longest sleep, plus a map of the awake windows.</p></div>`}`;
  v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { progMetric = b.dataset.m; render(); });
  const all = $('#all'); if (all) all.onclick = () => { showAll = !showAll; render(); };
  const rep = $('#rep'); if (rep) rep.onclick = () => go('report');
  bindGo(v);
}

/* ---------- the report: start of the plan compared with the latest nights ---------- */
function compare(ns) {
  const k = Math.max(1, Math.min(3, Math.floor(ns.length / 2)));
  const avg = (arr, key) => arr.reduce((a, n) => a + stats(n)[key], 0) / arr.length;
  const a = ns.slice(0, k), z = ns.slice(-k);
  return { k, rows: METRICS.map(m => ({ m, from: avg(a, m.k), to: avg(z, m.k) })) };
}
function reportData() {
  const ns = doneNights();
  const st = ns.map(stats);
  const throughIdx = st.findIndex(s => s.through);
  let streak = 0; for (let i = st.length - 1; i >= 0 && st[i].through; i--) streak++;
  const c = ns.length >= 2 ? compare(ns) : null;
  const awake = c && c.rows[0];
  let verdict;
  if (!c) verdict = 'Finish at least 2 nights to see a comparison.';
  else if (awake.to <= awake.from * 0.5 || streak >= 3) verdict = `Wonderful progress. ${name()} has learned to settle. Keep the same bedtime and routine.`;
  else if (awake.to < awake.from) verdict = `Getting there. Awake time is coming down. Stay consistent; it usually keeps improving.`;
  else verdict = `Not improving yet. Be honest about whether every night followed the plan, since giving in restarts the lesson. If you have been consistent, check with your doctor that nothing else is going on.`;
  return { ns, st, throughIdx, streak, c, verdict };
}
function reportText(r) {
  const lines = [`Sleep Coach report for ${name()}`,
    `${r.ns.length} night${r.ns.length === 1 ? '' : 's'}${r.ns.length ? ' (' + day(r.ns[0].started) + ' to ' + day(r.ns[r.ns.length - 1].started) + ')' : ''}, program ${programLabel(S.program)}`];
  if (r.c) {
    lines.push(`First ${r.c.k} nights vs last ${r.c.k} nights:`);
    r.c.rows.forEach(({ m, from, to }) => lines.push(`- ${m.label}: ${m.fmt(from)} to ${m.fmt(to)}`));
  }
  lines.push(`Slept through: ${r.st.filter(s => s.through).length} of ${r.ns.length} nights${r.throughIdx >= 0 ? ' (first on night ' + (r.throughIdx + 1) + ')' : ''}`);
  lines.push(r.verdict);
  return lines.join('\n');
}
function reportScreen(v) {
  const r = reportData();
  const finished = !!S.finished;
  v.innerHTML = `${header(finished ? 'Final report' : 'Report', finished ? 'home' : 'progress')}
    <div class="hero"><img class="moon-img" src="icon-192.png" alt="">
      <h1>${esc(name())}'s sleep report</h1>
      <p class="muted">${r.ns.length} night${r.ns.length === 1 ? '' : 's'} of ${planLen()}${r.ns.length ? ' · ' + day(r.ns[0].started) + ' to ' + day(r.ns[r.ns.length - 1].started) : ''}</p></div>
    <div class="card"><p class="verdict">${esc(r.verdict)}</p></div>
    ${r.c ? `<div class="card"><h2>Start vs now</h2>
      <p class="small muted">Average of the first ${r.c.k} night${r.c.k === 1 ? '' : 's'} compared with the last ${r.c.k}.</p>
      <table class="cmp"><tbody>${r.c.rows.map(({ m, from, to }) => {
        const good = m.better === 'down' ? to < from : to > from, same = Math.abs(to - from) < 0.05;
        const pct = from > 0 ? Math.round((to - from) / from * 100) : null;
        return `<tr><th>${m.label}</th><td>${m.fmt(from)}</td><td class="arrow">→</td><td><b>${m.fmt(to)}</b></td>
          <td class="${same ? '' : good ? 'up' : 'down'}">${pct == null || same ? '' : (pct > 0 ? '+' : '') + pct + '%'}</td></tr>`;
      }).join('')}</tbody></table></div>` : ''}
    <div class="card">
      <div class="chips">
        <span class="chip">Slept through <b>${r.st.filter(s => s.through).length}</b> nights</span>
        ${r.throughIdx >= 0 ? `<span class="chip">First time <b>night ${r.throughIdx + 1}</b></span>` : ''}
        <span class="chip">Current streak <b>${r.streak}</b></span>
        <span class="chip">Check-ins <b>${r.st.reduce((a, s) => a + s.checks, 0)}</b></span>
      </div>
    </div>
    ${r.ns.length ? `<div class="card"><h2>Awake time trend</h2>${trendChart(METRICS[0], r.ns)}<p class="small">${trendWords(METRICS[0], r.ns)}</p></div>
      <div class="card"><h2>Awake windows</h2>${sleepMap(r.ns.slice(-planLen()), Math.max(1, r.ns.length - planLen() + 1))}</div>` : ''}
    <button class="btn primary" id="share">Share report</button>
    ${finished ? `<button class="btn" id="again">Start a new plan</button>` : `<button class="btn ghost" id="stop">Stop the Sleep Coach and keep this as the final report</button>`}`;
  $('#share').onclick = async () => {
    const text = reportText(r);
    try { if (navigator.share) return await navigator.share({ title: 'Sleep Coach report', text }); } catch (e) { return; }
    try { await navigator.clipboard.writeText(text); $('#share').textContent = 'Copied. Paste it into WhatsApp or email'; }
    catch (e) { alert(text); }
  };
  const stop = $('#stop'); if (stop) stop.onclick = stopCoach;
  const again = $('#again'); if (again) again.onclick = newPlan;
  bindGo(v);
}
function stopCoach() {
  if (!confirm('Stop the Sleep Coach? Your nights are kept and this becomes the final report.')) return;
  S.finished = Date.now(); save(); go('report');
}
function newPlan() {
  if (!confirm('Start a new plan? This clears the nights in Progress. Share the report first if you want to keep it.')) return;
  S.nights = []; S.finished = null; save(); go('home');
}

function readyScreen(v) {
  v.innerHTML = `${header('Are you ready?')}
    <p class="muted">The preparation is what makes the training gentle and quick. Tick these off before night 1.</p>
    <div class="card">${READY.map(([k, t, d]) => `<label class="check"><input type="checkbox" data-k="${k}" ${S.ready[k] ? 'checked' : ''}>
      <div><b>${t}</b><span>${d}</span></div></label>`).join('')}</div>
    <div class="tip"><b>Not medical advice.</b> Check with your clinic or doctor before you start, especially about night feeds.
      If the crying sounds different, or ${esc(name())} seems unwell, in pain or teething badly, go in and comfort them, and pause the training.</div>`;
  v.querySelectorAll('[data-k]').forEach(c => c.onchange = () => { S.ready[c.dataset.k] = c.checked; save(); });
  bindGo(v);
}

function settingsScreen(v) {
  v.innerHTML = `${header('Settings')}
    <div class="card">
      <h2>${esc(name())}</h2>
      <p class="muted">Bed ${S.baby.bed} · Awake ${S.baby.wake}</p>
      <button class="btn" data-go="setup">Change name or times</button>
      <p class="muted" style="margin-top:16px">Program: <b style="color:var(--text)">${programLabel(S.program)}</b> · check-ins ${S.checkinSecs} sec</p>
      <button class="btn" data-go="program">Change program</button>
    </div>
    <div class="card">
      <div class="toggle"><span>Soft “shhh” sound</span><input type="checkbox" id="snd" ${S.sound ? 'checked' : ''}></div>
      <div class="toggle"><span>Vibrate</span><input type="checkbox" id="vib" ${S.vibrate ? 'checked' : ''}></div>
      <button class="btn" id="test">Test the alert now</button>
      <button class="btn" id="locktest">Test with the screen locked</button>
      <p class="small muted" id="lockmsg">Tap it, then lock your phone. After 20 seconds you should hear a soft shhh.</p>
      <p class="small muted">The shhh plays at your phone's <b>media volume</b> (the volume buttons), so turn it up a little.
        ${isIOS ? 'iPhones never let web apps vibrate, so on iPhone it is sound only.' : ''}</p>
    </div>
    <div class="card">
      <h2>Plan length</h2>
      <div class="seg">${[10, 14, 21, 28].map(d => `<button data-plan="${d}" class="${planLen() === d ? 'on' : ''}">${d} nights</button>`).join('')}</div>
      <p class="small muted">The trend line and report are measured over this many nights.</p>
      <button class="btn" data-go="report">Get my report</button>
      ${S.finished ? '' : `<button class="btn ghost" id="stop">Stop the Sleep Coach (final report)</button>`}
    </div>
    <div class="card">
      <button class="btn ghost" id="wipe">Clear progress (start a new plan)</button>
      <button class="btn ghost" id="reset">Reset everything</button>
    </div>
    <p class="small muted center">Sleep Coach v${APP_VERSION}. Everything stays on this phone and works offline.<br>
      Method notes adapted from Katie Bunton's “How I Gently Sleep Trained”. Not medical advice.</p>`;
  $('#snd').onchange = e => { S.sound = e.target.checked; save(); };
  $('#vib').onchange = e => { S.vibrate = e.target.checked; save(); };
  $('#test').onclick = () => psst();
  $('#locktest').onclick = () => {
    if (trackPlaying()) {
      stopTrack(); $('#locktest').textContent = 'Test with the screen locked'; $('#lockmsg').textContent = 'Test stopped.';
      return;
    }
    startTrack(20000, 'Sleep Coach test');
    $('#locktest').textContent = 'Stop the test';
    $('#lockmsg').textContent = 'Lock your phone now. The shhh comes in 20 seconds and repeats every 10. Unlock and tap Stop when you have heard it.';
  };
  v.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { S.planNights = +b.dataset.plan; save(); render(); });
  const stop = $('#stop'); if (stop) stop.onclick = stopCoach;
  $('#wipe').onclick = () => { if (confirm('Delete all nights from Progress?')) { S.nights = []; S.finished = null; save(); render(); } };
  $('#reset').onclick = () => { if (confirm('Delete the baby details, program and all progress?')) { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); } };
  bindGo(v);
}

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
