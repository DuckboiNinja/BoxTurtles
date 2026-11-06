# Live video from your scrcpy window

The **Live feed** page accepts a window shared by your desktop browser. With the phone already mirrored wirelessly in scrcpy on Ubuntu, share that scrcpy window to preview it in Asian Baddies. You can then start local turtle detection on sampled frames. No OBS, MediaMTX, stream URL, or additional video server is needed.

## Connect the existing mirror

```text
Avata 2 → Goggles N3 → Android running DJI Fly
                              ↓ wireless scrcpy
                    scrcpy window on Ubuntu
                              ↓ browser window sharing
                    Asian Baddies Live feed
                              ↓ optional sampled JPEG frames
                    Local detection → review queue
```

1. Keep your working wireless scrcpy connection running and open the actual flight video on the phone. Confirm that the video appears in scrcpy.
2. On that same Ubuntu desktop, open Asian Baddies at **http://localhost:8000** or **http://127.0.0.1:8000** and choose **Live feed**. HTTPS also supports browser window sharing; ordinary HTTP on a LAN IP does not provide the required secure browser context.
3. Select **Share scrcpy window**, choose the scrcpy window in the browser/Ubuntu sharing picker, and approve sharing. Choose the phone mirror instead of the dashboard window to avoid capturing the dashboard recursively.

The browser requires a fresh sharing choice for each connection; the website cannot silently select a window or restore permission after reloading. Only video is requested. Keep the scrcpy window available and check the preview before starting detection. The shared image includes any phone controls, DJI overlays, borders, or other visible content in that window.

Use **Stop sharing** or the browser's sharing control to disconnect. Leaving the Live feed page also stops sharing and frame sampling. Sharing a window proves that the browser has a video source; it does not verify a drone connection or prove that the picture is current.

## Run local detection

Previewing alone does not save frames or run inference. After checking the image:

1. Choose the local detector in **Settings**. The demo engine remains available without a model, drone, Ultralytics, or paid services, and its results are visibly marked as simulated.
2. Set a sampling interval and session frame limit on **Live feed**. The defaults are one frame every **5 seconds**, up to **60 frames**. The interval accepts **1–3600 seconds** and the limit **1–1000 frames**.
3. If the backend uses `TURTLE_INGEST_TOKEN`, expand **Advanced connection settings** and enter the matching **Ingest token**. The token is held only in the current page's memory.
4. Select **Start detection**. Each sampled JPEG is sent to the existing `/api/ingest/frame` endpoint and processed by the active local detector. Candidates appear in the normal review workflow, with their source and model provenance preserved.

The page sends one frame at a time. The interval is the minimum time between sampling starts: after inference finishes, the sampler waits only for the remaining interval. If inference takes longer than the interval, the next frame starts after completion without queuing stale frames. Sampling stops on the frame limit, an error, **Stop detection**, the end or temporary pause of window sharing, navigation away, or hiding the dashboard tab. Return to the visible tab and select **Start detection** to resume after a pause. A frame already submitted may finish processing and remain stored after stopping. Original submitted frame bytes, rejected candidates, crops, and annotations follow the existing retention rules.

This is sampled detection, not inference on every video frame. Adjust the interval for your computer's inference speed and storage needs. The browser shares the scrcpy window as displayed; ensure the flight view is visible before sending frames. Submitted images preserve the full shared frame and its aspect ratio, reducing its longest edge to at most 1920 pixels without enlarging smaller frames. Frames are encoded as JPEG at quality 0.92.

## Metadata and provenance

The browser sends an envelope with `source: "scrcpy-window"`, empty original-camera `metadata`, a timezone-aware `frame_captured_at`, and no upstream detections. The timestamp is measured when the image is copied from the preview, before JPEG encoding, upload, or model processing. The backend runs the active detector and retains its model identity and mock status.

New snapshots show **Live frame captured** in the inspector and retain `browser frame capture` provenance. This is the browser snapshot time, recorded to milliseconds and displayed with seconds; the browser clock and any video-mirroring delay affect its relationship to the camera's original exposure time. Explicit original capture metadata takes precedence if available. Earlier saved frames are not backfilled from upload time. Latitude and longitude remain null unless actual GPS is supplied, and these frames do not become map observations without GPS. CSV exports include the timestamp source.

The dashboard does not decode DJI's radio protocol or use a DJI live SDK. Hardware transport stays separate from the detector. Recorded media remains available through **Upload media**.

## Ubuntu troubleshooting

- **No sharing picker:** use a desktop browser with screen-capture support and open the dashboard through localhost, loopback, or HTTPS. Screen capture needs a direct user click.
- **A Wayland picker does not open or offers no usable source:** check Ubuntu's PipeWire and desktop-portal screen-sharing support for your desktop session and browser. The website cannot supply or repair the operating system's capture portal.
- **Black, frozen, or wrong image:** first check scrcpy itself, select its actual window again, and keep the mirrored flight view visible. Minimized or hidden windows can behave differently across desktop sessions. Protected phone video may not be capturable.
- **Detection stops with a token error:** enter the backend's configured ingestion token and start detection again.
- **Detection reports a model error:** check the active model and its local path in Settings. Demo mode provides a model-free way to verify the workflow; its candidates are simulated.

No drone, goggles, or Ubuntu screen-sharing session is available in this Windows development workspace. Real capture with the user's Ubuntu browser and actual DJI video still requires a hardware check; automated browser fixtures can validate preview and ingestion behavior independently.

References: [scrcpy](https://github.com/Genymobile/scrcpy), [scrcpy TCP/IP connections](https://github.com/Genymobile/scrcpy/blob/master/doc/connection.md), and [browser screen capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia).
