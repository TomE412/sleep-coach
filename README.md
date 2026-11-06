# Sleep Coach

An offline phone app (PWA) for gentle sleep training: a soft check-in timer with encouragement while the parent waits.

- Plain static files, no build step: `index.html`, `style.css`, `app.js`, `sw.js`.
- Everything is saved on the phone (localStorage key `sleepcoach.v1`). No server, no accounts.
- Tracking: plan length 10/14/21/28 nights (default 21). Progress shows a trend line (least-squares fit) for awake time, wakings, settling and longest sleep, plus an awake-window map. Report compares the first 3 nights with the last 3; "Stop the Sleep Coach" sets `finished` and freezes it as the final report.
- Programs: 4·8·12, 8·8·12·12, 12·12·12, or custom minutes. After the last check-in the parent may pick the baby up, or do one more wait.
- Alert: iPhones mute Web Audio with the silent switch and freeze the app when the screen locks, so each wait plays ONE generated 16-bit WAV through an <audio> element: silence for the wait, then the alert every 10 s. Alert is a choice in Settings: "Beep beep" (default; two 0.16 s 494 Hz tones, rounded on/off) or "Shhh" (3 s, 300-1900 Hz noise). The user disliked a sharp psst and the shhh on their phones for 2 min, at 16 kHz (8 kHz harsh on Samsung; tracks over 20 min drop to 8 kHz for memory). Audio keeps playing with the screen locked. Vibration works on Android only (iOS has no web vibration). Settings has "Test with the screen locked" (20 s).
- Method notes are paraphrased from Katie Bunton's "How I Gently Sleep Trained" (paid guide). Do not copy its text into the app or the repo.

## Releasing a change
Bump `CACHE` in `sw.js` and `APP_VERSION` in `app.js`, then commit and push.

## Ideas for later
- Automatic check-in timer (10–30 s) that cues the parent to leave.
- Twins: two babies tracked side by side.

## v2 (6 Nov 2026)
- Sleeps are `S.nights[]` entries with `kind: 'night' | 'nap'` (old entries without `kind` are nights). The night window is `S.baby.bed`–`S.baby.wake`; a sleep started outside it (with 30 min grace before bedtime) is a day nap. Night numbers count nights only.
- Notes: `session.notes[]` while a sleep runs, otherwise `S.notes[]`. Quick chips + free text.
- Minimise: `screen` can leave `'session'` while `S.live` runs; `#mini` bar counts down, and the alarm jumps back to the timer unless the note sheet is open.
- Tap out: `session.tappedOut` (+ `waking.tappedOut`); red bars/markers on charts.
- Taking over: start a sleep from typed times (put-down, check-ins done, current wait start).
- Export: full text log (for a doctor or an AI) as file/text/clipboard, plus CSV.
