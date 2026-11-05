# Asian Baddies · Turtle survey workspace

A local, responsive turtle detection dashboard for **recorded DJI Avata 2 footage and uploaded photographs**. Demo mode is the default and works without a drone, model file, PyTorch, or paid API.

## Start on this computer

On the existing development computer, the project-local Python environment, portable Node runtime, and production frontend are already prepared. From the local `BoxTurtleProject` directory in PowerShell:

In the GitHub repository, this application is in `dashboard/`; run the setup commands from that folder. The repository's training notebook remains separate from the website.

```powershell
.\.venv\Scripts\python.exe website.py
# Or: .\run.ps1
```

Open **http://127.0.0.1:8000**. API documentation is at **http://127.0.0.1:8000/docs**. Stop with Ctrl+C. The launcher rebuilds the frontend when its source changes; it never installs packages or downloads models automatically.

## Fresh installation: Windows

Install Python 3.11 or 3.12 and Node.js 22 LTS (22.12 or newer). Then:

```powershell
cd C:\path\to\BoxTurtles\dashboard
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
cd frontend
npm ci
npm run build
cd ..
.\.venv\Scripts\python.exe website.py
```

If Windows points `python` to a Store shortcut, use `py -3.12` or the full path to your installed interpreter. The portable tooling in `.tools/` is optional and specific to this development workspace.

## Fresh installation: Linux Mint

With Python 3.11/3.12, the matching `python3-venv` package, and Node.js 22 LTS installed:

```bash
cd /path/to/BoxTurtles/dashboard
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
cd frontend
npm ci
npm run build
cd ..
.venv/bin/python website.py
```

FFmpeg/`ffprobe` is optional for embedded video capture tags. Without it, video decoding and external telemetry still work, and missing tags are reported. H.264 MP4 is the most portable export choice for Avata 2 recordings; unsupported codecs produce a failed job with an explanation.

## Use the workspace

- **Dashboard:** detection totals, pending/verified/rejected counts, average confidence, recent sightings, review activity, and a location map.
- **Pending detections:** inspect the full frame, saved annotation, or crop; toggle boxes; confirm or reject. Rejected records remain available in the archive.
- **Verified sightings:** search by ID, filename, or coordinates; filter by capture date, confidence, and GPS availability; sort; export CSV; or return a mistaken verification to pending.
- **Turtle map:** OpenStreetMap/Leaflet markers for verified records with GPS. Marker popups open the sighting. Fit all markers with the expand button. Missing locations never become map markers.
- **Upload media:** multiple photographs or one video at a time, optional GPS/capture time, configurable frame sampling, external CSV/SRT telemetry, and processing progress.
- **Settings:** select the demo engine or a registered .pt model, change confidence and video defaults, and register more models by their backend-local paths.
- **Live feed:** save a MediaMTX WebRTC/HLS browser-player address, open/reload/stop the embedded preview, and follow the Goggles N3/Android connection guide. Video preview is separate from live inference, which remains off. See [Live feed setup](docs/LIVE_FEED.md).

The **Text size** menu in the top bar offers Standard, Large (default), and Extra large. The selection is saved in this browser. The interface uses larger labels, higher-contrast secondary text, larger controls, and responsive layouts on wide and small screens.

The **Light/Dark** button beside Text size switches the entire workspace theme. Dark is the default; your browser saves the choice. The Spotify-inspired layout uses neutral surfaces, a compact sidebar, rounded controls and a green accent. Dark mode pairs bright green primary buttons with dark text; light mode pairs deep green buttons with white text. Disabled controls remain readable. The map follows the selected theme; photos keep their original colors. Dashboard review actions remain available on mobile.

The capture-time timezone field can be left blank when the camera's timezone is unknown. The original local timestamp is preserved and flagged, rather than applying the computer's current offset. Failed files stay selected after a partial upload so they can be retried. See [the bug review](docs/QA_REVIEW.md) for the fixes and verification scope.

Updates appear immediately after review and refresh from the backend every five seconds while the browser is visible. The single local server serves both the UI and API. Uploaded files and SQLite records persist across restarts.

### Demo data

First startup seeds 12 synthetic detections: 7 pending, 4 verified, 1 rejected. The illustrations, coordinates, and capture times are explicitly marked **synthetic demo**. Uploaded photographs processed by the demo engine receive a fixed **87% simulated candidate**, subject to the confidence threshold; this does not inspect their contents or prove a turtle is present. Set a threshold above 87% to exercise the no-candidate case.

To generate an example photograph and a six-second recording:

```powershell
.\.venv\Scripts\python.exe scripts/create_example_data.py
```

Upload files in `examples/generated/`. The example telemetry files contain synthetic coordinates and timestamps; do not use them as real survey metadata.

For a fresh field database without seeded examples, set both of these in `.env` before startup:

```dotenv
TURTLE_DATA_DIR=./data-field
TURTLE_SEED_DEMO=false
```

Then select an actual model in Settings. Turning off seeding does not erase an existing database. Back up the whole configured data directory to preserve records and their images together.

### Enable local YOLO inference

Demo mode needs no ML packages. When you have a trusted local model:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-yolo.txt
```

1. Open Settings and register its `.pt` path **on the computer running FastAPI**, name, and candidate class labels.
2. Select it, choose the threshold, and save. Activation loads the model and reports errors before changing the saved engine.
3. Upload new media. Inference runs locally on CPU; existing records keep their original model provenance.

Class matching is case insensitive. Use the exact labels in your model, such as `turtle` or `box turtle`; leaving labels empty accepts all classes. No training is required. Only load model files you trust. Models are never fetched by name or URL. The default adapter handles axis-aligned YOLO detection boxes; other output types need a separate adapter that emits the common candidate format.

### Capture metadata and telemetry

- JPEG/other supported EXIF images: GPS and `DateTimeOriginal` are read before orientation is normalized. `OffsetTimeOriginal` is preserved when available. A timezone-less original stays timezone-less and is flagged.
- Video: `ffprobe` inspects available creation/location tags. Their provenance is displayed; verify the camera clock before treating creation tags as survey time.
- Manual values override embedded image/video values. For video, a supplied timestamp means **recording start**; frame timestamps add the actual frame offset.
- External telemetry overrides matched frame fields. CSV columns: `offset_seconds,latitude,longitude,captured_at`. ISO timestamps can include `Z` or an explicit offset. Both coordinates must be supplied together.
- SRT supports explicit `latitude` and `longitude`/`longtitude` fields and recognizable timestamps. DJI subtitle formats differ; unsupported layouts are rejected with a CSV alternative, rather than guessed.
- Matching uses the nearest sample within two seconds by default, configurable with `TURTLE_TELEMETRY_TOLERANCE_SECONDS`. GPS is not interpolated. An absolute telemetry timestamp is adjusted by the frame-to-sample offset.
- Missing GPS/capture time remains null. Upload time and filesystem modification time are never substituted for capture time.

See `examples/telemetry.csv`, `examples/telemetry.srt`, and [the interface specification](docs/ARCHITECTURE.md).

## Development and checks

For React hot reload, run FastAPI and Vite in separate terminals from the project root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
# Other terminal:
cd frontend
npm run dev
```

Vite runs at http://127.0.0.1:5173 and proxies `/api` and `/media` to FastAPI. On Linux use `.venv/bin/python`.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
cd frontend
npm run build
npx playwright install chromium
npm run test:e2e
```

The Playwright configuration starts its own backend on port 8011 with isolated data under `.tools/e2e-data/`; it does not review or upload into your normal database. On this computer, if Node is not on PATH, add the `.tools/node-*-win-x64` folder to PATH and set `PLAYWRIGHT_BROWSERS_PATH` to `.tools/browsers` before running browser tests. `requirements-lock.txt` records the exact Python packages validated in this workspace; `frontend/package-lock.json` locks the frontend.

## API

Successful responses use `{ "data": ... }`. Lists include pagination metadata where applicable. Errors use `{ "error": { "message": "...", "code": 422 } }`, with field details for request validation.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Local server/source status |
| `GET /api/detections?status=pending&limit=1000&offset=0` | Paginated candidates, all or by status |
| `GET /api/detections/{id}` | Candidate, media, provenance and metadata |
| `POST /api/detections/{id}/verify` | Pending → verified |
| `POST /api/detections/{id}/reject` | Pending → rejected |
| `POST /api/detections/{id}/reset` | Verified/rejected → pending |
| `GET /api/sightings` | Paginated verified detections |
| `GET /api/stats` | Aggregate statistics |
| `POST /api/upload` | Multipart image file + JSON `metadata` |
| `POST /api/upload/video` | Multipart video + optional metadata, telemetry, interval, frame limit |
| `POST /api/ingest/frame` | Multipart image + standardized JSON `envelope` |
| `GET /api/jobs`, `GET /api/jobs/{id}` | Video job progress/errors |
| `GET /api/settings`, `PUT /api/settings` | Detection/video settings |
| `GET /api/models`, `POST /api/models` | Register/selectable local models |
| `GET /api/live-source`, `PUT /api/live-source` | Persist MediaMTX browser-player configuration; no network connection or inference starts |

Repeated or conflicting reviews return **409**, rather than duplicate sightings. A reset is required before another review. The verified record references the same image and detection; files are not moved or duplicated during verification.

## Project structure

```text
BoxTurtleProject/
  backend/app/
    main.py          # HTTP routes, validation, static frontend
    db.py            # SQLite/SQLAlchemy entities and sessions
    schemas.py       # Model/drone independent frame contract
    engine.py        # Demo and lazy local YOLO adapters
    ingestion.py     # Frame storage, crops, annotations, video jobs
    metadata.py      # EXIF, video tags, CSV/SRT synchronization
    streams.py       # Saved MediaMTX browser-player configuration
    demo.py          # Offline synthetic fixtures
    config.py        # Environment configuration
  frontend/
    src/App.jsx      # Dashboard, review, sightings, uploads, settings
    src/MapView.jsx  # Leaflet map and sighting popups
    src/LiveFeed.jsx # MediaMTX preview and N3/Android connection guide
    src/api.js       # Shared API client
    src/styles.css   # Tailwind and responsive theme
    src/readability.css # Readable typography, text scale and layouts
    src/themes.css   # Shared light/dark palette and readable control states
    package.json, package-lock.json, vite.config.js
  tests/test_workflow.py
  frontend/tests/workflow.spec.js
  scripts/create_example_data.py
  examples/          # Telemetry, ingestion envelope, generated fixtures
  docs/              # Architecture and development progress
  data/              # Ignored local SQLite, media, videos
  website.py, run.ps1
  requirements*.txt, .env.example
```

This is a single-user local application bound to loopback, with no general account/login layer. `TURTLE_INGEST_TOKEN` can protect the future frame-ingestion endpoint; it does not authenticate other routes. Before exposing the app beyond this computer, add authentication, TLS, and appropriate network access controls.

Video jobs run in the local server process with per-frame commits. A restart marks unfinished jobs failed; completed frames remain reviewable, and the recording is retained for reprocessing. Re-uploading creates a new job and may create duplicate candidates for already-processed frames. Full durable job resumption and multi-user deployment are future extensions.

OpenStreetMap tiles require internet access and attribution; saved GPS records and marker popups remain available if tiles fail. The app makes no cloud AI calls, uses no paid API credentials, and provides no billing or credit-purchase flows. See [development progress](docs/PROGRESS.md) for validation and remaining integration work.
