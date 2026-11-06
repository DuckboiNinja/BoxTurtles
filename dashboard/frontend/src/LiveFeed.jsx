import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CircleHelp, LoaderCircle, MonitorPlay, Play, Radio, ScanLine, Smartphone, Square } from 'lucide-react';
import { api } from './api.js';
import InfoHint from './InfoHint.jsx';
import LiveModelControls from './LiveModelControls.jsx';

function captureError(error) {
  if (error.name === 'NotAllowedError' || error.name === 'AbortError') return 'Window sharing was canceled or denied. Click Share scrcpy window to try again.';
  if (error.name === 'NotReadableError') return 'Ubuntu could not share that window. Keep scrcpy visible and check your browser’s screen-sharing permission and desktop portal.';
  if (error.name === 'NotFoundError') return 'No shareable window was found. Open scrcpy on this desktop, then try again.';
  return error.message || 'The window could not be shared. Open scrcpy and try again.';
}

export default function LiveFeed({ settings, models, onFrameProcessed, navigate, mode = 'source' }) {
  const [sharing, setSharing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [interval, setIntervalSeconds] = useState('5');
  const [maxFrames, setMaxFrames] = useState('60');
  const [token, setToken] = useState('');
  const [counts, setCounts] = useState({ frames: 0, candidates: 0 });
  const [lastResult, setLastResult] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [annotation, setAnnotation] = useState(null);
  const video = useRef(null);
  const annotatedCanvas = useRef(null);
  const previousMode = useRef(mode);
  const stream = useRef(null);
  const run = useRef(null);
  const mounted = useRef(false);
  const picking = useRef(false);
  const inFlight = useRef(false);
  const refresh = useRef(onFrameProcessed);
  refresh.current = onFrameProcessed;
  const model = models.find(item => item.id === settings.active_model_id);
  const demo = settings.active_model_id === 'demo';
  const modelView = mode === 'model';
  const supported = Boolean(window.isSecureContext && navigator.mediaDevices?.getDisplayMedia);

  function stopDetection(note = '') {
    if (run.current) {
      run.current.active = false;
      clearTimeout(run.current.timer);
    }
    if (mounted.current) {
      setRunning(false);
      if (note) setMessage(note);
    }
  }

  function stopSharing(note = 'Window sharing stopped.') {
    stopDetection();
    const previous = stream.current;
    stream.current = null;
    previous?.getTracks().forEach(track => track.stop());
    if (video.current) video.current.srcObject = null;
    if (mounted.current) {
      setSharing(false);
      setReady(false);
      setAnnotation(null);
      setMessage(note);
    }
  }

  useEffect(() => {
    mounted.current = true;
    function visibilityChanged() {
      if (document.hidden && run.current?.active) stopDetection('Detection stopped while this tab is hidden. Return here and start detection to resume.');
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', visibilityChanged);
      stopSharing();
    };
  }, []);

  useEffect(() => {
    if (previousMode.current !== mode) {
      stopDetection();
      setAnnotation(null);
      setMessage('');
      setError('');
      previousMode.current = mode;
    }
  }, [mode]);

  async function shareWindow() {
    if (picking.current || stream.current) return;
    setError('');
    setMessage('');
    setAnnotation(null);
    if (!supported) {
      setError('Window capture needs a desktop browser at http://localhost:8000, http://127.0.0.1:8000, or an HTTPS address. Open the dashboard on the Ubuntu desktop running scrcpy.');
      return;
    }
    picking.current = true;
    setChoosing(true);
    let selected;
    try {
      // The browser owns the chooser. A website cannot silently select a window.
      selected = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { ideal: 15, max: 30 } },
        audio: false,
        selfBrowserSurface: 'exclude',
      });
      if (!mounted.current) {
        selected.getTracks().forEach(track => track.stop());
        return;
      }
      const track = selected.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('No video was shared. Choose the scrcpy window and try again.');
      stream.current = selected;
      track.addEventListener('ended', () => {
        if (stream.current === selected) stopSharing('Window sharing ended. Share the scrcpy window again to reconnect.');
      });
      track.addEventListener('mute', () => {
        if (stream.current !== selected || !mounted.current) return;
        setReady(false);
        stopDetection('The shared window paused. Keep scrcpy visible, then start detection again when video returns.');
      });
      track.addEventListener('unmute', () => {
        if (stream.current === selected && mounted.current) setReady(Boolean(video.current?.videoWidth));
      });
      video.current.srcObject = selected;
      setSharing(true);
      setReady(false);
      await video.current.play();
      if (stream.current === selected && mounted.current) setReady(Boolean(video.current.videoWidth && !track.muted));
    } catch (err) {
      selected?.getTracks().forEach(track => track.stop());
      if (mounted.current) {
        stopSharing('');
        setError(captureError(err));
      }
    } finally {
      picking.current = false;
      if (mounted.current) setChoosing(false);
    }
  }

  async function sampleFrame(session) {
    if (!session.active || !mounted.current || inFlight.current) return;
    const started = performance.now();
    const player = video.current;
    const track = stream.current?.getVideoTracks()[0];
    if (!player || !track || track.readyState !== 'live' || track.muted || player.readyState < 2 || !player.videoWidth) {
      stopDetection('No video frame is available. Keep scrcpy visible and start detection when video returns.');
      return;
    }
    inFlight.current = true;
    setProcessing(true);
    try {
      const canvas = document.createElement('canvas');
      // Preserve the full shared frame and its aspect ratio, without enlarging it.
      const scale = Math.min(1, 1920 / Math.max(player.videoWidth, player.videoHeight));
      canvas.width = Math.max(1, Math.round(player.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(player.videoHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot capture video frames. Try another desktop browser.');
      const frameCapturedAt = new Date().toISOString();
      context.drawImage(player, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      // Stop/navigation during encoding must not submit another frame.
      if (!session.active || !mounted.current) return;
      if (!blob) throw new Error('The shared video frame could not be encoded. Share the window again and retry.');
      const result = await api.ingestFrame(blob, session.token, session.frames + 1, frameCapturedAt);
      session.frames += 1;
      session.candidates += result.detections.length;
      if (!mounted.current) return;
      setCounts({ frames: session.frames, candidates: session.candidates });
      setLastResult(result);
      // Refresh failures never turn a successfully stored frame into a failed upload.
      Promise.resolve(refresh.current?.()).catch(() => {});
      if (session.active && session.frames >= session.limit) stopDetection('Frame limit reached. Start detection to begin another session.');
    } catch (err) {
      if (mounted.current) {
        stopDetection();
        setError(`${err.message} Detection stopped; completed frames are retained. Check the source or settings before restarting.`);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setProcessing(false);
      // One request at a time. Slow inference reduces the sample rate instead of queuing frames.
      if (session.active && mounted.current) session.timer = setTimeout(() => sampleFrame(session), Math.max(0, session.interval * 1000 - (performance.now() - started)));
    }
  }

  function startDetection(event) {
    event.preventDefault();
    if (!ready || !stream.current || inFlight.current || run.current?.active) return;
    const seconds = Number(interval);
    const limit = Number(maxFrames);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      setError('Use a frame interval of 1–3600 seconds and a whole-number frame limit of 1–1000.');
      return;
    }
    const session = { active: true, interval: seconds, limit, token: token.trim(), frames: 0, candidates: 0, timer: null };
    run.current = session;
    setCounts({ frames: 0, candidates: 0 });
    setLastResult(null);
    setError('');
    setMessage('');
    setRunning(true);
    sampleFrame(session);
  }

  return <>
    <div className="page-heading"><div><div className="eyebrow accent">{modelView ? 'LIVE MODEL WORKSPACE' : 'LIVE SOURCE WORKSPACE'}</div><h1>{modelView ? 'Live YOLO' : 'Live feed'}<span className="heading-dot">.</span></h1><p>{modelView ? 'Watch your local model annotate the scrcpy feed with bounding boxes and confidence scores.' : 'Bring your wireless scrcpy window into the dashboard and sample frames for turtle detection.'}</p></div><span className={`badge ${sharing && ready ? 'green' : 'amber'}`}><Radio size={14} />{sharing ? 'Window shared' : 'No window shared'}</span></div>
    <div className="notice live-setup-note"><CircleHelp size={20} /><span><strong>Your scrcpy connection is the source.</strong>Keep DJI Fly visible in scrcpy on Ubuntu. Click Share scrcpy window, then choose that window in your browser’s sharing dialog.</span></div>
    <div className="live-layout">
      <section className="panel live-player-panel"><div className="section-top"><div><div className="eyebrow">{modelView ? 'YOLO ANNOTATIONS' : 'SCRCPY PREVIEW'}</div><h2>{modelView ? 'See what the model finds' : 'Your phone, on this workspace'}</h2></div><MonitorPlay size={24} /></div>
        <div className={`live-player scrcpy-player ${sharing ? 'is-sharing' : ''} ${modelView ? 'model-player' : ''} ${modelView && annotation ? 'has-annotation' : ''}`}>
          <video ref={video} autoPlay muted playsInline aria-label="Shared scrcpy video" onLoadedData={() => setReady(Boolean(stream.current?.getVideoTracks()[0]?.readyState === 'live' && !stream.current?.getVideoTracks()[0]?.muted))} onError={() => { stopSharing(); setError('The shared video could not play. Share the scrcpy window again.'); }} />
          <canvas ref={annotatedCanvas} aria-label="YOLO annotated frame" data-testid="live-model-canvas" />
          {!sharing && <div className="live-placeholder"><span><MonitorPlay size={48} /></span><h3>Your scrcpy view goes here</h3><p>Open the dashboard on the same desktop as scrcpy, then share its window. You can preview before starting detection.</p><span className="badge">Waiting for your window</span></div>}
        </div>
        {modelView && <div className="model-frame-caption" aria-live="polite">{annotation ? <><strong>Last analyzed frame{annotation.result.is_mock ? ' · Simulated annotations' : ''}</strong><br />Browser frame captured {new Date(annotation.capturedAt).toLocaleTimeString()} · {annotation.result.detections.length} candidate{annotation.result.detections.length === 1 ? '' : 's'}. The mirrored picture may be delayed.</> : 'The source preview is shown until the first result. Start live annotation to see model boxes.'}</div>}
        <div className="live-player-actions"><span>{sharing ? ready ? 'Receiving video · confirm this is the DJI Fly view you want to process.' : 'Waiting for video from the shared window…' : 'Select the scrcpy window in the browser’s sharing dialog.'}</span><div>{sharing ? <button className="button secondary" onClick={() => stopSharing()}><Square size={15} />Stop sharing</button> : <button className="button primary" onClick={shareWindow} disabled={choosing}>{choosing ? <LoaderCircle className="spin" size={17} /> : <MonitorPlay size={17} />}{choosing ? 'Choose a window…' : 'Share scrcpy window'}</button>}</div></div>
        {!supported && <div className="notice amber live-inference-note">Window capture needs a supported desktop browser on localhost or HTTPS. Use the Ubuntu desktop running scrcpy.</div>}
        <div className="notice live-inference-note"><ScanLine size={20} /><span><strong>{demo ? 'Demo simulator · Mock detections' : 'Local turtle detection'}</strong>{demo ? 'The demo engine produces simulated candidates regardless of image content. Select your turtle model in Settings for real inference.' : `Frames use ${model?.name || 'the active local model'} and your saved confidence threshold.`} {modelView ? 'Enable Save candidate frames if you want to keep detections in your records.' : 'Candidates enter your records using the review rule in Settings.'} The shared window is captured as shown, including phone controls and overlays.</span></div>
        <button className="text-button live-upload-link" onClick={() => navigate('pending')}>Review detections <ArrowRight size={17} /></button>
        <button className="text-button live-model-switch" onClick={() => navigate(modelView ? 'live' : 'live-model')}>{modelView ? 'Open source preview' : 'Open Live YOLO'}<ArrowRight size={17} /></button>
      </section>
      {modelView ? <div><LiveModelControls video={video} stream={stream} canvas={annotatedCanvas} ready={ready} processing={processing} inFlight={inFlight} setProcessing={setProcessing} ownerMounted={mounted} onAnnotated={setAnnotation} onFrameProcessed={onFrameProcessed} settings={settings} models={models} navigate={navigate} token={token} setToken={setToken} />{error && <div className="notice amber" role="alert">{error}</div>}{message && <p className="help-text" role="status">{message}</p>}</div> : <form className="panel live-config" onSubmit={startDetection}><div className="section-top"><div><div className="eyebrow">FRAME SAMPLING</div><h2>Run your turtle model</h2></div><ScanLine size={24} /></div>
        <p className="help-text">Preview stays on your screen. Start detection to save sampled frames and run the active model on the local backend.</p>
        <div className="field-with-help live-sampling-field"><div className="field-label-row"><label htmlFor="live-frame-interval">Frame interval (seconds)</label><InfoHint label="frame interval"><strong>How often to check the video.</strong> The model receives one still frame at this interval. For example, 5 seconds means about 12 frames per minute. A shorter interval saves more frames and gives the computer more work; a longer interval saves fewer. Slow processing can reduce the actual sampling rate.</InfoHint></div><input id="live-frame-interval" type="number" min="1" max="3600" step="0.25" required value={interval} onChange={event => setIntervalSeconds(event.target.value)} disabled={running || processing} /></div>
        <div className="field-with-help live-sampling-field"><div className="field-label-row"><label htmlFor="live-max-frames">Maximum frames per session</label><InfoHint label="maximum frames per session"><strong>When detection stops automatically.</strong> Set this to 60 to process at most 60 sampled frames in one run. This counts frames, not turtles: a frame may produce zero, one, or several candidates. The preview stays on after the limit is reached, and you can start another session.</InfoHint></div><input id="live-max-frames" type="number" min="1" max="1000" step="1" required value={maxFrames} onChange={event => setMaxFrames(event.target.value)} disabled={running || processing} /></div>
        <details className="live-advanced"><summary>Advanced connection settings</summary><label>Ingest token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} disabled={running || processing} /></label><p className="help-text">Only needed if your backend requires an ingest token. Kept in memory for this page.</p></details>
        <div className="live-config-buttons">{running ? <button className="button secondary" type="button" onClick={() => stopDetection('Detection stopped. Preview remains available.')}><Square size={16} />Stop detection</button> : <button className="button primary" type="submit" disabled={!ready || processing}>{processing ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{processing ? 'Finishing frame…' : 'Start detection'}</button>}</div>
        {error && <div className="notice amber" role="alert">{error}</div>}
        {message && <p className="help-text" role="status">{message}</p>}
        <div className="live-status-list" aria-live="polite"><div><span>Detection</span><strong>{running ? 'Detection running' : 'Detection off'}</strong></div><div><span>Frames processed</span><strong>{counts.frames}</strong></div><div><span>Candidates found</span><strong>{counts.candidates}</strong></div><div><span>GPS</span><strong>Unknown</strong></div><div><span>Frame capture time</span><strong>{counts.frames ? 'Recorded' : 'Not captured yet'}</strong></div></div>
        <p className="help-text">Live frame capture time is recorded from this browser's clock when each image is taken. The mirrored video may be delayed; this is the snapshot time shown as Live frame captured in the inspector.</p>
        {lastResult && <p className="help-text">Last frame saved with {lastResult.detections.length} {lastResult.detections.some(item => item.is_mock) ? 'mock ' : ''}candidate{lastResult.detections.length === 1 ? '' : 's'}.</p>}
        <p className="help-text">Sampling stops at the frame limit, on an error, when sharing ends, or when you switch pages or hide the tab. Switching to Live YOLO keeps the shared window available. A frame already submitted may finish saving.</p>
      </form>}
    </div>
    <section className="panel live-connection-guide"><div className="section-top"><div><div className="eyebrow">FROM YOUR PHONE TO THE MODEL</div><h2>Connect once. Share the window.</h2></div><Smartphone size={24} /></div><ol className="connection-steps scrcpy-steps"><li><span>01</span><h3>Open your scrcpy feed</h3><p>Use your working wireless connection and show DJI Fly in the scrcpy window. Keep it visible while capturing.</p></li><li><span>02</span><h3>Share it here</h3><p>Select Share scrcpy window and choose scrcpy in the browser or Ubuntu picker. Check the preview before starting detection.</p></li><li><span>03</span><h3>{modelView ? 'Start live annotation' : 'Start detection'}</h3><p>{modelView ? 'Choose a target frame rate and inference limit. Watch model boxes, and enable Save candidate frames when you want to retain results.' : 'Set a sample interval and frame limit. Run your local model, then review candidates in the existing queue.'}</p></li></ol><div className="live-guide-links"><a href="https://github.com/Genymobile/scrcpy/blob/master/doc/connection.md" target="_blank" rel="noopener noreferrer">scrcpy wireless connection <ArrowUpRight size={16} /></a><a href="https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia" target="_blank" rel="noopener noreferrer">Browser window sharing <ArrowUpRight size={16} /></a></div></section>
  </>;
}
