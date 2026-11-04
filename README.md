# Sleep Coach

An offline phone app (PWA) for gentle sleep training: a soft check-in timer with encouragement while the parent waits.

- Plain static files, no build step: `index.html`, `style.css`, `app.js`, `sw.js`.
- Everything is saved on the phone (localStorage key `sleepcoach.v1`). No server, no accounts.
- Programs: 4·8·12, 8·8·12·12, 12·12·12, or custom minutes. After the last check-in the parent may pick the baby up, or do one more wait.
- Alert is a synthesised soft "psst" plus vibration, repeated every 10 s until "Going in" is tapped. The screen is kept awake (Wake Lock) during a session; timing runs from timestamps, so it catches up if the phone sleeps.
- Method notes are paraphrased from Katie Bunton's "How I Gently Sleep Trained" (paid guide). Do not copy its text into the app or the repo.

## Releasing a change
Bump `CACHE` in `sw.js` and `APP_VERSION` in `app.js`, then commit and push.

## Ideas for later
- Automatic check-in timer (10–30 s) that cues the parent to leave.
- Twins: two babies tracked side by side.
