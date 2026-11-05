# Live video with Goggles N3, Android and MediaMTX

The website now has a **Live feed** page in the sidebar, plus a shortcut in Settings. It saves a MediaMTX browser-player URL in local SQLite and embeds that player when you choose **Open preview**. It does not start MediaMTX, connect the drone, or run live inference automatically.

## The connection path

```text
Avata 2 → Goggles N3 → Android running DJI Fly
                              ↓ publisher / screen-capture bridge
                         Computer → MediaMTX → Asian Baddies Live feed
```

DJI documents USB-C live-view sharing from Goggles N3 to a smartphone. Connect a USB-C **data** cable, open DJI Fly, and enter the flight live view. If the phone is not recognized, try the goggles' **Settings → About → OTG Wired Connection to Mobile Device** option. The [DJI N3 support page](https://www.dji.com/support/product/goggles-n3) and [N3 product page](https://www.dji.com/goggles-n3) describe this capability. N3 has no direct HDMI port.

MediaMTX receives a standard published stream and serves it to readers. It does not decode the Avata radio link or make the N3 a normal USB webcam. DJI's documented phone live view does not establish that direct RTMP publication is available in every N3/DJI Fly combination.

## Getting the phone's view onto the computer

There are two routes to investigate with your actual hardware:

1. **If your connected DJI Fly setup exposes an RTMP publishing option**, point it to MediaMTX on the computer's LAN address. DJI's general [livestream guide](https://repair.dji.com/help/content?customId=01700006727&lang=en&paperDocType=ARTICLE&re=US&spaceId=17) describes RTMP, but does not confirm every N3/Avata 2 combination. Confirm the option is present first.
2. **A capture bridge:** mirror Android to the computer over Wi-Fi, capture that visible window in OBS, and publish from OBS to MediaMTX. [scrcpy](https://github.com/Genymobile/scrcpy) is a free Android mirroring tool with [TCP/IP connection instructions](https://github.com/Genymobile/scrcpy/blob/master/doc/connection.md). A wireless connection leaves the phone's USB-C port available for the N3 cable. Android wireless-debugging setup depends on the phone/version. Verify that DJI Fly's actual video appears in the mirrored window; a black or protected video surface needs a different source bridge.

The capture route is a proposed integration path, not a hardware-tested guarantee. No drone, goggles, or phone is connected to this development workspace. No mirroring software, OBS, or MediaMTX was installed automatically.

## MediaMTX setup and a first preview

1. Follow the official [MediaMTX installation guide](https://mediamtx.org/docs/kickoff/install) on your computer. Use a local installation; no paid hosting is required.
2. Publish video to a path such as `turtle`. For OBS RTMP publication, MediaMTX's [OBS guide](https://mediamtx.org/docs/publish/obs-studio) uses a Custom service, server URL `rtmp://127.0.0.1:1935/turtle`, and an empty stream key. A phone publisher must use the **computer's LAN IP**, not `127.0.0.1`, and the computer must accept the intended LAN connection.
3. For a first test with a typical OBS output, try the **HLS** browser player at `http://127.0.0.1:8888/turtle`. Open it directly and check that video plays.
4. In Asian Baddies, choose **Live feed → HLS**, enter that browser-player address, select **Save source**, then **Open preview**.
5. For lower latency, MediaMTX also exposes the **WebRTC** player at `http://127.0.0.1:8889/turtle`. Codec support and network requirements differ; the publisher must produce tracks the browser can decode. MediaMTX does not automatically transcode incompatible tracks. See [browser playback](https://mediamtx.org/docs/read/web-browsers) and [WebRTC browser codec support](https://mediamtx.org/docs/read/webrtc#codec-support-in-browsers).

Use the player-page address, not `rtsp://...`, `rtmp://...`, a `.m3u8` playlist, or a `/whep` endpoint. On another viewing computer, replace loopback with the MediaMTX host's LAN address. `127.0.0.1` always refers to the device opening the address.

The embedded player shows its own playback/connection errors. Asian Baddies deliberately says **Preview requested**, rather than claiming a live drone is connected based on an iframe loading. You can reload or stop the preview at any time. Saving a URL does not initiate a connection; reopening the page does not auto-connect.

## Detection and metadata

This page provides **video viewing only**. The cross-origin MediaMTX iframe does not expose decoded frames to Asian Baddies. A future server-side stream sampler should read a suitable MediaMTX source, sample frames, and POST them to `/api/ingest/frame` with synchronized metadata. This keeps source transport independent from the local detection model.

GPS and original camera timestamps must come from actual telemetry; a video relay or Android screen mirror does not automatically provide them. Do not use preview time as the original capture time. The current ingestion API and recorded-video workflow already preserve missing metadata and provenance.

To process footage today, use **Upload media → Video**. Live inference remains explicitly off until a frame bridge is implemented and tested with the actual hardware.
