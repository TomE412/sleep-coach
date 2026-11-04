// Sleep Coach: a check-in timer for gentle sleep training. Everything is stored on the phone (localStorage).
const APP_VERSION = '1.1.0';
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
  'Stay put. You will hear a soft “psst” when it is time.',
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
  ['ten', 'You are committing to 10 nights', 'Even if it clicks on night 2, keep going for the full 10.']
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

/* ---------- helpers ---------- */
const $ = sel => document.querySelector(sel);
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

/* ---------- soft alert: a quiet "psst" made from filtered noise, plus a buzz ---------- */
let ac = null;
function unlockAudio() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === 'suspended') ac.resume();
  } catch (e) {}
}
function noise(t, dur, type, freq, peak) {
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.06, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(ac.destination);
  src.start(t); src.stop(t + dur);
}
function psst() {
  if (S.sound && ac) {
    try {
      const t = ac.currentTime + 0.02;
      for (const o of [0, 0.85]) {
        noise(t + o, 0.035, 'lowpass', 1400, 0.25);        // "p"
        noise(t + o + 0.07, 0.5, 'highpass', 4200, 0.22);   // "sst"
      }
    } catch (e) {}
  }
  if (S.vibrate && navigator.vibrate) navigator.vibrate([160, 120, 160]);
}

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
  save(); render();
}
function fireAlarm() {
  S.live.phase = 'alarm'; S.live.from = Date.now(); save();
  psst(); lastPsst = Date.now();
  if (document.visibilityState !== 'visible') notify('Time to check on ' + name(), 'Go in for a short, calm check-in.');
  render();
}
function goIn() { unlockAudio(); S.live.toldOut = false; S.live.phase = 'checkin'; S.live.from = Date.now(); save(); render(); }
function leftRoom() {
  liveWaking().checks.push(Math.round((Date.now() - S.live.from) / 1000));
  S.live.phase = S.live.step >= mins().length - 1 ? 'final' : 'ready';
  if (S.live.phase === 'ready') S.live.step++;
  save(); render();
}
function anotherRound() { S.live.step++; startWait(); }
function fellAsleep(pickedUp) {
  const w = liveWaking(); w.asleep = Date.now(); w.pickedUp = !!pickedUp;
  S.live.phase = pickedUp ? 'picked' : 'asleep'; save(); render();
}
function finishNight() {
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
     ready: readyScreen, settings: settingsScreen, morning: morningScreen }[screen] || homeScreen)(v, false);
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
  v.innerHTML = `
    <img class="scene" src="scene.jpg" alt="A child plays a flute to a smiling moon and stars">
    <div class="hero over">
      <h1>Tonight is night ${n}${n <= 10 ? ' of 10' : ''}</h1>
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
    <button class="btn primary big" id="start">Start bedtime</button>
    <div class="links">
      <button data-go="ready"><span>✅</span>Ready? ${done}/${READY.length}</button>
      <button data-go="progress"><span>📈</span>Progress</button>
      <button data-go="settings"><span>⚙️</span>Settings</button>
    </div>
    <p class="small muted center" style="margin-top:22px">Keep this screen open while you wait. It stays awake for you.</p>`;
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
    // Repeat the soft psst every 10 seconds until the parent taps "Going in".
    if (now - lastPsst > 10000) { psst(); lastPsst = now; }
    const late = $('#late'); const s = Math.floor((now - L.from) / 1000);
    if (late) late.textContent = s >= 5 ? `Alert went off ${mmss(s * 1000)} ago` : '';
  } else if (L.phase === 'checkin') {
    const secs = (now - L.from) / 1000, target = S.checkinSecs;
    const clk = $('#clk'); if (clk) clk.textContent = Math.floor(secs) + 's';
    const sub = $('#clksub'); if (sub) sub.textContent = secs >= target ? 'time to leave' : 'in the room';
    const bar = $('#bar'); if (bar) bar.setAttribute('stroke-dashoffset', RING * (1 - Math.min(1, secs / target)));
    if (secs >= target && !L.toldOut) { L.toldOut = true; if (S.vibrate && navigator.vibrate) navigator.vibrate(80); }
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
  v.innerHTML = `
    <div class="hero"><div class="moon">☀️</div><h1>Good morning!</h1>
      <p class="muted">Night ${screenArg + 1} is done. Be proud of yourselves.</p></div>
    <div class="card">
      <div class="chips">
        <span class="chip">Wakings <b>${Math.max(0, n.wakings.length - 1)}</b></span>
        <span class="chip">Check-ins <b>${nightChecks(n)}</b></span>
        <span class="chip">Crying <b>${nightCryMin(n)} min</b></span>
      </div>
    </div>
    <div class="tip"><b>Make the morning bright.</b> If ${esc(name())} is crying, wait for a calmer moment before you go in,
      so crying doesn't become the way out of the cot. Then open the curtains, sing, get some fresh air. Morning is fun; night is for sleep.</div>
    <button class="btn primary big" data-go="home">Done</button>
    <button class="btn ghost" data-go="progress">See progress</button>`;
  bindGo(v);
}

function progressScreen(v) {
  const ns = S.nights;
  const maxCry = Math.max(1, ...ns.map(nightCryMin));
  const shown = ns.slice(-10);
  const offset = ns.length - shown.length;
  v.innerHTML = `${header('Progress')}
    ${ns.length ? `<div class="card"><h2>Minutes of crying per night</h2>
      <div class="bars">${shown.map((n, i) => { const c = nightCryMin(n); return `<div class="col"><div class="v">${c}</div>
        <div class="b" style="height:${Math.round(c / maxCry * 100)}%"></div><div class="n">${offset + i + 1}</div></div>`; }).join('')}</div>
      <p class="small muted">Night number along the bottom. It usually drops fast after the first few nights.</p></div>
      <div class="card">${ns.map((n, i) => ({ n, i })).reverse().map(({ n, i }) => `<div class="night">
        <h3>Night ${i + 1} · ${day(n.started)}</h3>
        <div class="small muted">Down at ${clock(n.started)} · ${nightChecks(n)} check-ins · ${nightCryMin(n)} min crying${n.ended ? '' : ' · in progress'}</div>
        ${n.wakings.map((w, j) => `<div class="waking"><span style="min-width:74px">${j ? 'Waking ' + j : 'Bedtime'} ${clock(w.start)}</span>
          <span class="dots">${w.checks.map(() => '<span class="dot done"></span>').join('') || '<span class="small">no check-ins</span>'}</span>
          <span>${Math.round(cryMs(w) / 60000)} min${w.pickedUp ? ' · picked up' : ''}</span></div>`).join('')}
      </div>`).join('')}</div>`
    : `<div class="card center"><p>No nights yet.</p><p class="muted small">After each night you'll see wakings, check-ins and how long the crying lasted.</p></div>`}`;
  bindGo(v);
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
      <div class="toggle"><span>Soft “psst” sound</span><input type="checkbox" id="snd" ${S.sound ? 'checked' : ''}></div>
      <div class="toggle"><span>Vibrate</span><input type="checkbox" id="vib" ${S.vibrate ? 'checked' : ''}></div>
      <button class="btn" id="test">Test the alert</button>
      <p class="small muted">Turn your phone's volume up a little to test. iPhones don't vibrate from web apps, and the silent switch mutes the sound.</p>
    </div>
    <div class="card">
      <button class="btn ghost" id="wipe">Clear progress (start a new 10 nights)</button>
      <button class="btn ghost" id="reset">Reset everything</button>
    </div>
    <p class="small muted center">Sleep Coach v${APP_VERSION}. Everything stays on this phone and works offline.<br>
      Method notes adapted from Katie Bunton's “How I Gently Sleep Trained”. Not medical advice.</p>`;
  $('#snd').onchange = e => { S.sound = e.target.checked; save(); };
  $('#vib').onchange = e => { S.vibrate = e.target.checked; save(); };
  $('#test').onclick = () => { unlockAudio(); setTimeout(psst, 60); };
  $('#wipe').onclick = () => { if (confirm('Delete all nights from Progress?')) { S.nights = []; save(); render(); } };
  $('#reset').onclick = () => { if (confirm('Delete the baby details, program and all progress?')) { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); } };
  bindGo(v);
}

render();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
