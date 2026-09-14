# Historical version-one capture tools

**Legacy tooling, not adapted for the September 14 sealed-round application.** The completed 17-scene September 9 walkthrough uses `record.mjs` and `render-video.py` and demonstrates version-one funding, buy/sell trades and results. Its selectors, fixtures and narration are incompatible with the current default app. Rerendering a current product walkthrough with these scripts is unsupported.

The [historical walkthrough guide](../../docs/WALKTHROUGH.md) preserves the original setup and capture record. Reproducing that film requires the matching version-one application and fixture. The low-level capture examples below remain reference material; new version-two recording must validate new locators, actions, fixtures and narration first.

This machine has Playwright 1.63.0-alpha-2026-08-31 with native page screencasting. It records browser page content, without capturing the user's desktop or ordinary Chrome profile. The installed `@playwright/mcp` package no longer exports the binary expected by the old skill wrapper, so `pwcli.sh` resolves the CLI already bundled inside `playwright-core`.

Run commands from the repository root. The wrapper selects the isolated `robinhacks-walkthrough` session. Do not pass `--persistent`, `--profile`, or attach to the user's existing Chrome session.

```bash
bash scripts/walkthrough/pwcli.sh open http://127.0.0.1:5180 --browser=chrome
bash scripts/walkthrough/pwcli.sh resize 1920 1080
bash scripts/walkthrough/pwcli.sh snapshot
bash scripts/walkthrough/pwcli.sh video-start output/playwright/walkthrough.webm --size=1920x1080
# Follow references from fresh snapshots and perform actual app actions.
bash scripts/walkthrough/pwcli.sh video-stop
```

The default recording resolution fits inside 800×800, so explicitly set the size. Opening without `--headed` launches a separate headless browser. `video-stop` finalizes the WebM; do not encode an unfinished capture.

## Continuous scripted walkthrough

After validating locators against the running application, use `run-code --filename=...` for a single continuous take with deliberate pauses. The script file must contain a single async function expression, with no imports or exports. The vendor's recording guide documents these methods:

```javascript
async (page) => {
  await page.screencast.start({
    path: 'output/playwright/walkthrough.webm',
    size: { width: 1920, height: 1080 },
  });
  try {
    // Use the actual application's validated locators and actions here.
    await page.screencast.showChapter('Explore teams', {
      description: 'Browse projects before placing a trade.',
      duration: 1800,
    });
    // showOverlay(html, { duration }) adds optional callouts. They have
    // pointer-events:none and do not intercept the app's controls.
  } finally {
    await page.screencast.stop();
  }
};
```

For the finished walkthrough, `node scripts/walkthrough/record.mjs` writes one such function per scene and runs them in order. The source actions are maintained in `scene-actions.mjs`.

Do not substitute screenshots for completed actions. Show the actual receipt, allocation, or published result before moving to the next part. Start every take from a known local demo state; never put credentials or private production records in a walkthrough.

## Shareable MP4

```bash
bash scripts/walkthrough/encode-capture.sh \
  output/playwright/walkthrough.webm \
  output/playwright/robinhacks-walkthrough.mp4
```

An optional third argument adds a narration audio file. Narration should be timed to the video; the helper pads short audio with silence and stops at the video's end. The helper preserves the entire viewport, converts to 1920×1080 H.264/yuv420p MP4 with faststart, and checks the result with `ffprobe`. It refuses to overwrite an existing output.

Verified on 2026-09-09: all 17 app scenes were recorded, rendered and reviewed in the completed walkthrough. The capture method is documented in `playwright-core/lib/tools/skills/playwright-cli/references/video-recording.md`.
