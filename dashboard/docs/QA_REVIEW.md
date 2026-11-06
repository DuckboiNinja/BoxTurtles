# Theme and bug review

## Appearance

- Added a keyboard-accessible light/dark toggle beside Text size. Dark is the default; the browser saves the choice and restores it before the page first paints.
- Light mode covers navigation, dashboard, review cards, forms, settings, dialogs, status badges, notices, map controls/popups and the live-source configuration. Photographs keep their original colors; the video player keeps a dark surround.
- The Spotify-inspired redesign uses neutral charcoal/white surfaces, a compact sidebar, rounded controls and less decorative copy. Primary buttons pair bright green with dark text in dark mode and deep green with white text in light mode. Disabled buttons remain opaque and readable. Hover, selection and keyboard-focus states have their own clear colors.
- Dashboard shortcuts open uploads and the review queue. Confirm/reject actions remain visible on small screens; the earlier layout hid the featured review information on mobile.
- Theme changes apply the complete palette at once, avoiding transient low contrast while old foreground colors fade over new backgrounds.
- Browser checks measure settled button and visible text/background combinations at a contrast ratio of at least 4.5:1 across all seven pages in both themes. This is a focused color check, not a claim of complete accessibility conformance.

## Bugs fixed

| Issue | Result |
| --- | --- |
| Capture form used today's browser timezone offset for historical or unknown camera times | Offset now defaults to unknown. A blank offset preserves the camera's local time without asserting a timezone. |
| A poll started before Save settings could overwrite the saved result | Successful settings changes invalidate older refresh snapshots. |
| An explicit refresh during a poll was silently skipped | Mutation refreshes wait for the current request and fetch fresh data. |
| A statistics error after a successful review made the review appear failed | Candidate status and success feedback are committed independently; a synchronization message explains stale totals. |
| A partially successful photo batch cleared failed files too | Failed files remain selected for retry. |
| EXIF GPS without hemisphere references silently assumed north/east | GPS stays unknown unless both valid hemisphere references are present; malformed DMS values are rejected. |
| Truncated telemetry CSV rows could raise a server error | Missing optional fields stay unknown; invalid coordinate pairs return a clear validation error. |
| Live input depended on a relay-player URL without exposing frames for detection | The page now captures a browser-shared scrcpy window and optionally submits sampled frames through the existing ingestion API. Browser fixtures exercise preview, explicit detection, and null camera metadata. |
| Slow inference or a stopped capture could accumulate later frames | Only one frame request runs at a time; stopping, source loss, hidden tabs, and navigation stop the sampler. Browser fixtures cover slow responses, stop-sharing, navigation, and a picker that resolves after leaving the page. |
| A capped portrait preview could letterbox the image while boxes used the full container | The inspector preserves the actual image aspect ratio so pixel boxes align. |
| Updates to unrelated pending records rebuilt map markers and dismissed popups | Marker rebuilds depend on the located sightings' contents. |
| Switching pages during a Leaflet zoom could run a transition callback after the map was removed | Map zoom and automatic fitting are immediate; teardown stops pending movement and disconnects resize observation. Rapid shortcut navigation and zoom-away behavior are covered by the browser check. |
| A single successful map tile could hide errors for other tiles | Failed tiles are tracked until loaded successfully or unloaded. |
| Inspector dialog had no accessible name | Its heading now names the dialog. |
| User-uploaded mock detections appeared in the log as synthetic demo data | The log distinguishes synthetic examples, mock detections and model results. |

## Verification scope

Backend tests use temporary databases; browser tests use isolated data under `.tools/e2e-data/`. No survey records are changed by the tests. The tests exercise demo inference, controlled external frames, and generated canvas `MediaStream` fixtures for scrcpy window capture. Capture coverage includes preview without ingestion, explicit detection with unknown camera metadata, one request at a time, stopping and teardown, canceled sharing, ingestion failures, and in-memory token handling. These fixtures do not exercise the actual Ubuntu screen-sharing picker, PipeWire/desktop portal, or DJI hardware. Capturing the user's Avata 2/N3/Android image through scrcpy and validating the real model's accuracy still require hardware/source-media checks.

Run `python -m pytest -q` in the project's environment, `npm run build` inside frontend, and `npm run test:e2e` with the configured local test browser. Exact final results are recorded in [PROGRESS.md](PROGRESS.md).
