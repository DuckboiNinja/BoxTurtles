import { ShieldCheck } from 'lucide-react';
import './auto-accept.css';

export default function AutoAcceptSettings({ draft, setDraft }) {
  const enabled = Boolean(draft.auto_accept_enabled);
  const threshold = draft.auto_accept_threshold ?? 0.95;
  const percentage = threshold === '' ? '' : Number((Number(threshold) * 100).toPrecision(15));
  return <section className="auto-accept-settings" aria-labelledby="auto-accept-title">
    <div className="auto-accept-heading"><h3 id="auto-accept-title"><ShieldCheck size={19} />Automatic acceptance</h3><span className={`badge ${enabled ? 'green' : ''}`}>{enabled ? 'YOLO only' : 'Off'}</span></div>
    <label className="auto-accept-toggle"><input type="checkbox" checked={enabled} onChange={event => setDraft(current => ({ ...current, auto_accept_enabled: event.target.checked }))} /><span>Automatically accept high-confidence turtles</span></label>
    <p className="help-text">New local YOLO turtle detections at or above this score go straight to Verified sightings. Lower-confidence candidates stay in the review queue.</p>
    <label className="auto-accept-threshold">Automatic acceptance threshold (%)<input type="number" min="1" max="100" step="any" required={enabled} disabled={!enabled} value={percentage} onChange={event => setDraft(current => ({ ...current, auto_accept_threshold: event.target.value === '' ? '' : Number(event.target.value) / 100 }))} /></label>
    <p className="help-text">Use a score at least as high as the detection confidence threshold. This rule applies to new detections; existing pending records stay unchanged. Demo, mock, and upstream results always await review.</p>
    <p className="help-text">Model confidence can be wrong. Automatically accepted sightings are labeled and can be returned to pending for review.</p>
  </section>;
}
