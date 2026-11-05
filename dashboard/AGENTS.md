# Project instructions

This project is a local FastAPI/React/SQLite turtle survey dashboard.

- Preserve the user's spending restriction: do not purchase credits, upgrades, paid resets, or use paid API access to continue work. Stop when included usage is exhausted and record completed work and next steps in docs/PROGRESS.md.
- Keep demo mode fully functional without Ultralytics, a .pt model, a drone, or paid services.
- Do not assume DJI Avata 2 supports any live SDK or network video interface. Recorded media is the current source.
- Keep hardware sources separate from model adapters. The frame ingestion contract is documented in docs/ARCHITECTURE.md.
- Never infer GPS from an upload location or substitute upload/processing time for capture time. Unknown values remain null.
- Mark mock results and synthetic demo records visibly. Do not represent synthetic coordinates as wildlife observations.
- Retain original uploads, rejected detections, and detection provenance. Review transitions use conditional database updates.
- App data is local and ignored by version control. Avoid modifying data/ during tests; use temporary storage.
- Run backend tests and a frontend production build after relevant changes. Browser workflow tests require an isolated database (see frontend/playwright.config.js).
