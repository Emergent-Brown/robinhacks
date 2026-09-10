# RobinHacks walkthrough

**Recording date: September 9, 2026.** This video shows the interface before the September 10 redesign. It has not been re-recorded. The recording scripts now target the redesigned interface for a future recording.

**[Watch the walkthrough](https://robinhacks-2026-ajs--walkthrough-pyhnt4be.web.app/walkthrough/)** — **4:19, 17 chapters**, with English captions, chapter navigation and a full transcript. The preview is available until **October 9, 2026**.

The video follows the fictional **Foundry Weekend 2026** event from project discovery through published results, with **12 teams and 48 participants**. Alex Chen is Mosaic’s captain, Sam Rivera is a teammate, and Jamie Park is the organizer. The phone chapter shows the same application at a mobile viewport.

The recording uses the local demo and performs real application commands for funding, trades, notes and results. Its fictional credits have no cash value; it contains no real participant records or production account actions. Judge scores are example aggregates entered by the organizer after judging outside the application.

The voice is **Samantha**, an installed macOS English (US) synthetic voice, generated locally at 155 words per minute. No cloud speech service or paid voice API was used. It is product narration, not a recording of an event participant.

**[Try the interactive demo](https://robinhacks-2026-ajs--walkthrough-pyhnt4be.web.app/).** This preview starts in the default trading preset. The video starts from a separate Foundry seed scenario, so its phase, holdings and funding figures differ. Preview activity stays in that browser’s local storage; it does not change the production event. Both preview links expire on October 9.

## Completed artifacts

- [MP4 video](../output/playwright/walkthrough/RobinHacks-walkthrough.mp4): 1920 × 1080, 30 fps, H.264 video, 48 kHz AAC audio, 17 embedded chapters and an English subtitle track.
- [Local chapter player](../output/playwright/walkthrough/index.html): captions, chapter navigation, downloads and transcript; open alongside its generated video and assets.
- [SRT captions](../output/playwright/walkthrough/captions.srt) and [VTT captions](../output/playwright/walkthrough/captions.vtt): 64 cues timed to the measured narration.
- [Complete transcript](../output/playwright/walkthrough/transcript.txt): narration with chapter start times.
- [Chapter timings](../output/playwright/walkthrough/chapters.json) and [render report](../output/playwright/walkthrough/render-report.json): measured output details.
- [Measured narration plan](../output/playwright/walkthrough/narration-plan.json) and [audio durations](../output/playwright/walkthrough/audio-durations.json): assembly inputs generated from the authored script.

The final cut lasts 259.055 seconds, including time to read the actual quotes, receipts and results. Market values are the application’s calculated values. The narration specifies the fixed seed example and selected trade quantities without claiming a fixed secondary-market price.

## Recorded chapters

| Chapter | Perspective | Recorded screen and action |
| --- | --- | --- |
| 01 · Alex opens the market | Alex / captain | Explore in the seed phase; browse the twelve sample projects and Mosaic’s account. |
| 02 · Read the projects | Alex / captain | Open Halide (`team-3`), read its Postgres migration pitch and latest checkpoint. Nimbus appears in chapter 12. |
| 03 · Reserve seed funding | Alex / captain | Request 20 Halide shares at 100 credits each; review the 2,000-credit reservation and save. |
| 04 · A private, editable commitment | Alex / captain | Open Portfolio and review the editable, private Halide commitment while funding remains open. |
| 05 · Jamie closes and settles funding | Jamie / organizer | Close seed funding, confirm allocation, and continue settlement until the event reaches build time. |
| 06 · See the allocation | Alex / captain | Review allocated holdings in Portfolio, open Activity to see the seed receipt, then return to Holdings. |
| 07 · Open a trading window | Jamie / organizer | Open a 30-minute trading window and show its phase and deadline. |
| 08 · Review and buy three shares | Alex / captain | Review the current quote for 3 Halide shares, confirm the purchase, and show its accepted receipt. |
| 09 · Sell one share | Alex / captain | After the cooldown, review the proceeds for selling 1 Halide share, confirm, and show its receipt. |
| 10 · Record the reasoning | Alex / captain | Save the private Halide note reproduced below: a destructive migration caught before merge, a failed-backfill concern, and a 4 PM demo follow-up. |
| 11 · Sam sees the shared portfolio | Sam / member | Review Mosaic’s shared Portfolio and investment note, then the Team page and roster. |
| 12 · Check projects on a phone | Alex / mobile | Browse Nimbus on a 390 × 844 phone viewport, read its update, and return to Portfolio through bottom navigation. |
| 13 · Pause, announce and resume | Jamie / organizer | In Admin, pause with a reason, publish the checkpoint announcement, and resume with the original deadline. |
| 14 · Close trading before judging | Jamie / organizer | Close trading, freeze portfolios, and enter example aggregate judge scores from 0 to 100, collected outside the app. |
| 15 · Review the final share values | Jamie / organizer | Preview judge ranks and final share values, including tied scores. Review without locking yet. |
| 16 · Settle and publish the reports | Jamie / organizer | Lock scores, continue result settlement, review the completed reports, and explicitly publish them. |
| 17 · Three distinct outcomes | Alex / final standings | Visit Seed fundraising, Investing teams, and Judged projects to show the three final standings. |

The exact saved note in chapter 10 is:

- **Why we’re backing this project:** “Marcus caught a destructive migration before merge. The rollback preview is clear and useful.”
- **What would change our mind:** “A failed backfill leaves the database in an unclear state.”
- **Next check-in:** “Ask Marcus to run the failing-backfill demo at 4 PM.”

Chapter 6 explains the locked fundraising vault while showing Portfolio and the seed receipt. Chapter 13 stays in the organizer’s paused view. Chapter 15 only previews the score table; score locking happens in chapter 16.

## Complete narration

### 01 · Alex opens the market

RobinHacks lets hackathon teams build projects and back each other with fictional credits. We’re following Alex Chen, Mosaic’s captain. Each team starts with ten thousand credits and a shared portfolio.

### 02 · Read the projects

Explore shows twelve sample teams. Halide checks Postgres migrations for destructive changes. Nimbus keeps downloaded forecasts available offline. Open a project to read the current progress and understand the idea before investing.

### 03 · Reserve seed funding

The seed round offers everyone the same fixed price. Alex requests twenty Halide shares at one hundred credits each, reserving two thousand credits. The funding sheet shows the commitment before saving.

### 04 · A private, editable commitment

Commitments stay private until settlement finishes. Alex can revise the sheet while funding is open. Reserved credits remain in Mosaic’s wallet, but aren’t available for another commitment.

### 05 · Jamie closes and settles funding

Now Jamie Park, the organizer, closes funding. Requests lock, and settlement processes each team from the same allocation plan. Progress is saved along the way, so an interrupted session can continue safely.

### 06 · See the allocation

Alex’s portfolio now shows the allocated shares and funding receipt. Halide’s raised funding belongs to a locked project vault. It does not become spending money for Halide’s own investment team.

### 07 · Open a trading window

Jamie opens a thirty-minute trading window. Everyone sees the current phase and deadline. There are up to three windows, giving teams time to build and share progress between trading periods.

### 08 · Review and buy three shares

Alex buys three more Halide shares. The review fetches a fresh quote and shows the exact cost before confirmation. Prices move with the exchange’s reserves. Once accepted, the purchase has a receipt.

### 09 · Sell one share

After the cooldown, Alex sells one share. The review shows the proceeds before submission, and another receipt records the outcome. Teams can adjust positions without waiting for another person to take the opposite trade.

### 10 · Record the reasoning

Holdings, available credits and receipts stay together. Alex adds a private note about Halide’s migration demo: what looks promising, what could change the decision, and what to check next.

### 11 · Sam sees the shared portfolio

Sam Rivera sees the same Mosaic holdings and notes. Regular teammates can review investments and maintain the team profile. Trading stays with the captain and designated trader, using one shared wallet.

### 12 · Check projects on a phone

On a phone, bottom navigation and focused project pages keep the same flows accessible. Alex browses Nimbus, reads its update, and checks the portfolio while walking between team tables.

### 13 · Pause, announce and resume

Jamie pauses trading and posts an announcement. Financial actions stop while everyone catches up. Resuming restores the window with its original deadline; a pause does not silently add more trading time.

### 14 · Close trading before judging

Jamie closes trading and freezes portfolios before judging. Judges score projects independently, outside this application. Jamie then enters their aggregate scores, from zero to one hundred.

### 15 · Review the final share values

The preview turns those judge rankings into final share values and handles tied scores. Jamie reviews the table before locking it. These values come from project judging, rather than the final trading price.

### 16 · Settle and publish the reports

Results processing calculates each portfolio from frozen cash and holdings. It creates reports without changing anyone’s spendable balance. After every team is processed and checked, Jamie publishes the complete results together.

### 17 · Three distinct outcomes

Final standings separate three outcomes: seed fundraising, investing teams, and judged projects. They show which ideas attracted support, how teams invested, and what judges rewarded. Everything here used fictional sample teams and credits.

## Reproduce the walkthrough

Run from the repository root. Requirements are Node.js 22.12+, npm dependencies, macOS with the Samantha voice, `ffmpeg` and `ffprobe` on `PATH`, Python 3 with Pillow, and a Playwright CLI with native page screencasting. This recording used Playwright `1.63.0-alpha-2026-08-31`. The wrapper finds an installed CLI; on another workstation, set `ROBINHACKS_PLAYWRIGHT_CLI` to its `playwright-core/lib/tools/cli-client/cli.js`. See [capture tooling](../scripts/walkthrough/CAPTURE.md) for the browser dependency details.

Install dependencies and start the demo server in one terminal:

```sh
npm install
VITE_APP_MODE=demo npm run dev -w @robinhacks/web -- --port 5180
```

In a second terminal, generate the audio and fresh fixture, install it into the isolated recording browser, record all chapters, and assemble the result:

```sh
node scripts/walkthrough/generate-audio.mjs
node scripts/walkthrough/create-scenario.mjs
export ROBINHACKS_CAPTURE_SESSION=robinhacks-film
bash scripts/walkthrough/pwcli.sh open http://127.0.0.1:5180 --browser=chrome
bash scripts/walkthrough/pwcli.sh run-code --filename output/playwright/walkthrough/installer-seed.js
node scripts/walkthrough/record.mjs
python3 scripts/walkthrough/render-video.py
```

The fixture generator uses the shared `GameService` to create the other teams’ funding commitments and checks credit/share conservation. Mosaic begins with 10,000 credits and no investments. The installer only targets localhost port 5180 and replaces the isolated demo’s local storage. Recording then follows [scene-actions.mjs](../scripts/walkthrough/scene-actions.mjs) through the actual interface. It captures separate browser-page clips, not the desktop or the user’s regular browser profile.

For every fresh full recording, generate and reinstall the seed fixture immediately before capture so its deadline and starting state are current. A partial retry such as `node scripts/walkthrough/record.mjs 10 17` requires the same browser session in the exact state left after chapter 9. Selecting a range does not restore a checkpoint or rewind accepted actions. If that state is unavailable, reinstall a fresh fixture and record from chapter 1.

The renderer combines the captured clips with measured narration, frames desktop/mobile views, and writes the MP4, standalone player, poster, captions, chapter metadata and transcript into `output/playwright/walkthrough/`. It reuses rendered clips when their source fingerprints match. After a narration-only change, regenerate the audio and rerun the renderer; recapture affected scenes if the actions or their timing also need to change. `python3 scripts/walkthrough/render-video.py --force` deliberately re-encodes every clip.

## Edit or regenerate narration

The authored source is [scripts/walkthrough/narration.json](../scripts/walkthrough/narration.json). It contains the ordered script, perspectives and voice settings, with no generated audio paths or durations. Edit it when changing narration, then run:

```sh
node scripts/walkthrough/generate-audio.mjs
```

The generator calls local macOS `say` with argument arrays and narration text files. It produces original AIFFs, 48 kHz mono PCM WAVs and a text file per segment in `output/playwright/walkthrough/audio/`. IDs match the source, such as `08-buy.wav`. It measures audio with ffprobe, then writes `narration-plan.json`, `audio-durations.json` and `narration-transcript.txt` for assembly.

Existing audio is reused when its saved text and voice settings match and both formats have valid, matching durations. Changed or missing segments are regenerated and validated before replacing existing audio. To regenerate all segments or choose another output directory:

```sh
node scripts/walkthrough/generate-audio.mjs --force
node scripts/walkthrough/generate-audio.mjs --output-dir /absolute/path/to/walkthrough
node scripts/walkthrough/generate-audio.mjs --help
```

macOS speech export needs access to the host speech service. In a restricted sandbox, `say` can report success while writing an empty stream; the generator detects and rejects that output. Run with the necessary host speech permission when regenerating audio.
