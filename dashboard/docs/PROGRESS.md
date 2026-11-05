# Development progress

## Completed

- Redesigned the website with Spotify-inspired charcoal surfaces, a compact rounded sidebar, bold headings, pill-shaped buttons and a brighter green accent. Light mode uses neutral white surfaces. The shorter dashboard introduction provides direct upload/review actions; featured confirm/reject controls remain visible on mobile.
- Prepared the project for the existing `DuckboiNinja/BoxTurtles` repository under `dashboard/`, preserving its root research README and `challenge-x.ipynb`. Runtime data, local configuration, model weights, build output and development tools are excluded. GitHub publication requires an authenticated connection; see the latest handoff for upload status.
- Renamed the website, browser title, API title, CSV filename, launcher message and setup guides to Asian Baddies. Adjusted the sidebar wordmark to fit the longer name at all text sizes.

- Local FastAPI backend, SQLAlchemy/SQLite persistence, local images and video storage.
- React/Tailwind responsive interface with light/dark themes and all seven workspace pages.
- Candidate inspection: full frame, crop, saved annotation, bounding-box toggle, confidence and provenance.
- Confirm, reject, rejected archive, reset, duplicate-review protection; original images are reused.
- Verified record with search, date/location/confidence filters, sorting, CSV export, verification timestamps.
- Leaflet/OpenStreetMap map, marker details, fit-to-sightings, missing-GPS handling and tile-failure notice.
- Dashboard counts, latest captured sighting, recent detections and review activity.
- Photo uploads, EXIF GPS/capture-time extraction, orientation normalization, manual metadata overrides.
- Recorded-video sampling, limits, progress/jobs, per-frame commits, optional CSV/SRT synchronization.
- Demo engine and clearly labeled synthetic fixtures, requiring no model or drone.
- Local YOLO adapter, model registry, confidence/video settings, model provenance and replacement support.
- Stable multipart frame-ingestion API for future upstream detections, streams, ROS 2 or companion hardware.
- Optional frame-ingestion token; installation instructions, examples, and a cross-platform launcher.
- Project-local free Python/Node tooling and dependencies prepared on this Windows workstation.
- Readability update: larger relative typography, brighter secondary text, stronger button contrast, larger controls, less wide-screen gutter space, and persistent Standard/Large/Extra large text sizes.
- Added Live feed page and a Settings shortcut for a saved MediaMTX WebRTC/HLS browser-player address. Preview can be opened, reloaded or stopped; it does not claim drone connectivity or start inference.
- User hardware confirmed: DJI Avata 2, Goggles N3, Android phone. Connection paths and official references are saved in docs/LIVE_FEED.md; the hardware bridge remains unverified.
- Added a saved, keyboard-accessible theme toggle. Both themes cover forms, cards, dialogs, notifications and Leaflet maps; photographs retain their original colors.
- Replaced pale primary buttons with readable controls: bright green/dark text in dark mode and deep green/white text in light mode. Preserved disabled-state readability and removed palette fades that briefly caused poor contrast while switching themes.
- Completed a focused bug review: fixed guessed capture timezones, polling/save races, skipped explicit refreshes, misleading review failures, lost failed-upload selections, incomplete EXIF GPS, truncated telemetry CSV errors, live URL validation, portrait-box alignment, map popup resets, tile-error notices, unnamed dialogs and mock provenance labels. Details: docs/QA_REVIEW.md.

## Validation

- Backend integration tests: **34 passed**, including regression coverage for incomplete EXIF GPS references and truncated telemetry rows, plus the original workflow and live-source coverage.
- Frontend production build: passed.
- Latest redesign verification: **34 backend tests and 16 browser checks passed**, plus the production build. Browser coverage now also exercises dashboard shortcuts, zooming before navigation, and visible mobile review actions. Fixed a Leaflet callback that could run after rapid page navigation.
- Asian Baddies rename validation: production build and 30 backend tests passed; 3 targeted desktop/mobile/text-size browser checks passed. The sidebar wordmark fits the longer name.
- Browser validation: **16 passed** in the final suite. Coverage includes both themes across all seven pages, saved appearance, measured button and visible-copy contrast, extra-large mobile layouts, partial-upload retries, unknown capture timezones, saved reviews during statistics failures, stale polling snapshots, portrait-box alignment, persistent map popups, and the original review/upload/video/map/live-preview workflows. The embedded-player check uses a controlled test player; no actual MediaMTX server or drone stream was available.
- Fixed issues found during validation: unsaved settings being replaced by polling, capture sorting across timezone offsets, map layers covering mobile navigation, hidden file input causing mobile overflow, and Windows path separators in the SPA's API error handling.
- Updated desktop/mobile dashboard screenshots and added `artifacts/dashboard-wide.png` and `artifacts/live-feed-desktop.png`.
- Theme screenshots: `artifacts/dashboard-light.png`, `artifacts/dashboard-dark.png`, and `artifacts/dashboard-light-mobile.png`.
- Launcher smoke check passed on Windows: homepage, compiled assets, health/stats endpoints, SPA navigation, JSON 404 responses, and preservation of the 12-record demo database. Test servers were stopped after verification.
- The current test dependencies emit one non-blocking Starlette/httpx deprecation warning. The corrupt-video test also intentionally triggers a codec diagnostic.
- Actual .pt inference and DJI source-media compatibility require user-supplied weights/footage; neither is present in the workspace.

## Next integration steps

1. Start `website.py`, review the demo, and try example/photo/video uploads.
2. Install optional YOLO dependencies when ready; register a trusted turtle .pt file and compare results on actual survey images.
3. Test the user's Avata 2 recordings, inspect available metadata, and supply camera-aligned telemetry where available. Transcode unsupported footage to H.264 MP4 if necessary.
4. Follow docs/LIVE_FEED.md to verify N3 → Android live-view sharing, a publisher/capture bridge to the computer, and MediaMTX playback. Then implement a transport/decoder adapter that POSTs the existing frame contract for live inference. Do not assume DJI SDK support.
5. Add durable job resumption/deduplication and access controls only if longer jobs or network/multi-user use require them.

## Spending and resumption

No paid API, billing, purchase, upgrade, paid reset, or credit-purchase integration has been added. Continue only within the user's included allowance; if that limit is reached, stop, preserve files, and update this progress file before resuming after reset. No paid continuation is authorized.

Source and examples are in this directory; runtime records live in the configured data directory. Preserve the whole data directory when backing up or resuming.
