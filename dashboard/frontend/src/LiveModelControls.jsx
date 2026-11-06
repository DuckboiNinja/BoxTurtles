import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Play, ScanLine, Square } from 'lucide-react';
import { api } from './api.js';
import InfoHint from './InfoHint.jsx';
import './live-model.css';

function paintAnnotation(output, snapshot, result) {
  if (result.width !== snapshot.width || result.height !== snapshot.height) throw new Error('The model returned a different frame size. Share the window again before restarting.');
  output.width = snapshot.width;
  output.height = snapshot.height;
  const context = output.getContext('2d');
  if (!context) throw new Error('This browser cannot draw the model view. Try another desktop browser.');
  context.drawImage(snapshot, 0, 0);
  const fontSize = Math.max(16, Math.round(output.width / 55));
  context.font = `600 ${fontSize}px sans-serif`;
  context.lineWidth = Math.max(2, output.width / 450);
  for (const item of result.detections) {
    const [x1, y1, x2, y2] = item.bounding_box;
    const label = `${result.is_mock ? 'MOCK · ' : ''}${item.class_name} ${Math.round(item.confidence * 100)}%`;
    context.strokeStyle = '#53ff8a';
    context.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const labelWidth = Math.min(output.width, context.measureText(label).width + 14);
    const left = Math.min(x1, output.width - labelWidth);
    const top = Math.max(0, y1 - fontSize - 12);
    context.fillStyle = '#53ff8a';
    context.fillRect(left, top, labelWidth, fontSize + 12);
    context.fillStyle = '#06210e';
    context.fillText(label, left + 7, top + fontSize + 2, labelWidth - 14);
  }
}

export default function LiveModelControls({ video, stream, canvas, ready, processing, inFlight, setProcessing, ownerMounted, onAnnotated, onFrameProcessed, settings, models, navigate, token, setToken }) {
  const [fps, setFps] = useState('5');
  const [limit, setLimit] = useState('300');
  const [persist, setPersist] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState({ frames: 0, saved: 0, rate: null, latency: null, result: null });
  const session = useRef(null);
  const mounted = useRef(false);
  const callbacks = useRef({ onAnnotated, onFrameProcessed });
  callbacks.current = { onAnnotated, onFrameProcessed };
  const model = models.find(item => item.id === settings.active_model_id);

  function stop(note = '') {
    if (session.current) {
      session.current.active = false;
      clearTimeout(session.current.timer);
    }
    if (mounted.current) {
      setRunning(false);
      if (note) setMessage(note);
    }
  }

  useEffect(() => {
    mounted.current = true;
    function visibilityChanged() {
      if (document.hidden) stop('Annotation stopped while this tab is hidden. Start again to resume.');
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      mounted.current = false;
      stop();
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  useEffect(() => {
    if (!ready && session.current?.active) stop('Annotation stopped because the shared video paused or ended.');
  }, [ready]);

  async function infer(current) {
    if (!mounted.current || !current.active || inFlight.current) return;
    const source = stream.current;
    const track = source?.getVideoTracks()[0];
    const player = video.current;
    if (!player || !track || track.readyState !== 'live' || track.muted || player.readyState < 2 || !player.videoWidth) {
      stop('No current video frame is available. Check the scrcpy window before restarting.');
      return;
    }
    inFlight.current = true;
    setProcessing(true);
    const started = performance.now();
    try {
      const snapshot = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(player.videoWidth, player.videoHeight));
      snapshot.width = Math.max(1, Math.round(player.videoWidth * scale));
      snapshot.height = Math.max(1, Math.round(player.videoHeight * scale));
      const context = snapshot.getContext('2d');
      if (!context) throw new Error('This browser cannot capture model frames.');
      const capturedAt = new Date().toISOString();
      context.drawImage(player, 0, 0, snapshot.width, snapshot.height);
      const blob = await new Promise(resolve => snapshot.toBlob(resolve, 'image/jpeg', 0.9));
      if (!mounted.current || !current.active || stream.current !== source || track.readyState !== 'live' || track.muted) return;
      if (!blob) throw new Error('The model frame could not be encoded.');
      const result = await api.inferFrame(blob, current.token, current.frames + 1, capturedAt, current.persist);
      // Persistence may have completed even when the user stopped during inference.
      if (ownerMounted.current && result.image_id) Promise.resolve().then(() => callbacks.current.onFrameProcessed?.()).catch(() => {});
      if (!mounted.current || !current.active || stream.current !== source || track.readyState !== 'live' || track.muted) return;
      if (!canvas.current) return;
      paintAnnotation(canvas.current, snapshot, result);
      current.frames += 1;
      current.saved += result.image_id ? 1 : 0;
      const completed = performance.now();
      if (current.firstResultAt === null) current.firstResultAt = completed;
      const elapsed = completed - current.firstResultAt;
      setMetrics({ frames: current.frames, saved: current.saved, rate: current.frames > 1 && elapsed > 0 ? (current.frames - 1) * 1000 / elapsed : null, latency: result.inference_ms, result });
      callbacks.current.onAnnotated?.({ capturedAt, result });
      if (current.frames >= current.limit) stop('Inference frame limit reached. Start live annotation to begin another session.');
    } catch (err) {
      if (mounted.current) {
        stop();
        setError(`${err.message} Live annotation stopped.`);
      }
    } finally {
      inFlight.current = false;
      if (ownerMounted.current) setProcessing(false);
      if (mounted.current && current.active) current.timer = setTimeout(() => infer(current), Math.max(0, 1000 / current.fps - (performance.now() - started)));
    }
  }

  function start(event) {
    event.preventDefault();
    if (!ready || inFlight.current || session.current?.active) return;
    const target = Number(fps);
    const maximum = Number(limit);
    if (!Number.isFinite(target) || target < 1 || target > 10 || !Number.isInteger(maximum) || maximum < 1 || maximum > 10000) {
      setError('Use a target of 1–10 frames per second and a whole-number limit of 1–10,000 frames.');
      return;
    }
    const current = { active: true, fps: target, limit: maximum, persist, token: token.trim(), frames: 0, saved: 0, firstResultAt: null, timer: null };
    session.current = current;
    setMetrics({ frames: 0, saved: 0, rate: null, latency: null, result: null });
    setError('');
    setMessage('');
    setRunning(true);
    callbacks.current.onAnnotated?.(null);
    infer(current);
  }

  const result = metrics.result;
  const demo = result ? result.is_mock : settings.active_model_id === 'demo';
  return <form className="panel live-config live-model-config" onSubmit={start}>
    <div className="section-top"><div><div className="eyebrow">CONTINUOUS INFERENCE</div><h2>Watch the model work</h2></div><ScanLine size={24} /></div>
    <p className="help-text">Each result redraws the analyzed frame with boxes and confidence scores. The model runs as fast as this computer can process frames, up to your target.</p>
    <div className="field-with-help live-sampling-field"><div className="field-label-row"><label htmlFor="model-target-fps">Target frames per second</label><InfoHint label="target frames per second">A target of 5 requests up to five analyzed frames per second. Slower inference lowers the actual rate; requests run one at a time so old frames do not build up.</InfoHint></div><input id="model-target-fps" type="number" min="1" max="10" step="1" required value={fps} onChange={event => setFps(event.target.value)} disabled={running || processing} /></div>
    <label>Maximum inference frames<input type="number" min="1" max="10000" step="1" required value={limit} onChange={event => setLimit(event.target.value)} disabled={running || processing} /></label>
    <label className="checkbox-label model-save-option"><input type="checkbox" checked={persist} onChange={event => setPersist(event.target.checked)} disabled={running || processing} /><span>Save candidate frames</span></label>
    <p className="help-text">{persist ? 'Frames containing candidates are saved to your records. Automatic acceptance follows the rule in Settings; other candidates await review.' : 'View only. Frames and predictions are not added to your records.'}</p>
    <details className="live-advanced"><summary>Advanced connection settings</summary><label>Ingest token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} disabled={running || processing} /></label><p className="help-text">Only needed if your backend requires a token. Kept in memory for this page.</p></details>
    <div className="live-config-buttons">{running ? <button type="button" className="button secondary" onClick={() => stop('Live annotation stopped. The last analyzed frame remains visible.')}><Square size={16} />Stop live annotation</button> : <button type="submit" className="button primary" disabled={!ready || processing}>{processing ? <LoaderCircle className="spin" size={17} /> : <Play size={17} />}{processing ? 'Finishing frame…' : 'Start live annotation'}</button>}</div>
    {error && <div className="notice amber" role="alert">{error}</div>}
    {message && <p className="help-text" role="status">{message}</p>}
    <div className="live-status-list" aria-live="polite"><div><span>Annotation</span><strong>{running ? 'Annotation running' : 'Annotation off'}</strong></div><div><span>Actual annotation rate</span><strong>{metrics.rate !== null ? `${metrics.rate.toFixed(1)} fps` : metrics.frames ? 'Measuring…' : '—'}</strong></div><div><span>Inference latency</span><strong>{metrics.latency !== null ? `${Math.round(metrics.latency)} ms` : '—'}</strong></div><div><span>Frames annotated</span><strong>{metrics.frames}</strong></div><div><span>Candidates in frame</span><strong>{result?.detections.length ?? 0}</strong></div><div><span>Saved candidate frames</span><strong>{metrics.saved}</strong></div></div>
    <div className={`notice model-engine-note ${demo ? 'amber' : ''}`}><ScanLine size={18} /><span><strong>{demo ? 'Demo simulator · Mock detections' : result?.model_name || model?.name || 'Local YOLO model'}</strong>{demo ? 'Simulated boxes demonstrate the viewer. Choose your YOLO model in Settings for real inference.' : 'Boxes are model predictions. Review records or use your configured automatic acceptance rule.'}</span></div>
    <p className="help-text">Stopping ends further requests. A candidate frame already submitted may finish saving. Hiding this tab or changing pages stops annotation.</p>
    <button type="button" className="text-button" onClick={() => navigate('settings')}>Model and acceptance settings <ArrowRight size={16} /></button>
  </form>;
}
