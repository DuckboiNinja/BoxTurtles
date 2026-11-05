import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Boxes, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clock3, Cpu, Crosshair, Eye, FileImage, Film, Focus, FolderOpen, ImagePlus, LayoutDashboard, LoaderCircle, Map, MapPin, Menu, Moon, Plane, Plus, RefreshCw, ScanLine, Search, Settings2, ShieldCheck, SlidersHorizontal, Sprout, Sun, Upload, X, XCircle } from 'lucide-react';
import { api } from './api.js';
import MapView from './MapView.jsx';
import LiveFeed from './LiveFeed.jsx';

const NAV = [
  ['dashboard', 'Dashboard', LayoutDashboard], ['pending', 'Pending detections', ScanLine],
  ['sightings', 'Verified sightings', ShieldCheck], ['map', 'Turtle map', Map],
  ['upload', 'Upload media', Upload], ['live', 'Live feed', Eye], ['settings', 'Settings', Settings2],
];
const shortId = value => value?.slice(0, 8).toUpperCase();
const percent = value => `${Math.round(value * 100)}%`;
const captureOrder = (a, b, oldest = false) => {
  if (!a.captured_at && !b.captured_at) return 0;
  if (!a.captured_at) return 1;
  if (!b.captured_at) return -1;
  return (new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime()) * (oldest ? 1 : -1);
};
const stamp = value => {
  if (!value) return 'Capture time missing';
  const unknownZone = !/([+-]\d{2}:\d{2}|Z)$/.test(value);
  if (unknownZone) return `${value.slice(0, 16).replace('T', ' ')} · timezone unknown`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value));
};
const coordinates = item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude) ? `${item.latitude.toFixed(5)}, ${item.longitude.toFixed(5)}` : 'GPS unavailable';

function TurtleMark({ size = 30 }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="24" cy="26" rx="12" ry="13" /><path d="M21 13V8q3-5 6 0v5m-11 5-6-5m22 5 6-5M16 34l-6 5m22-5 6 5m-14 0v4"/><path d="m24 19 6 4v7l-6 4-6-4v-7z"/></g></svg>;
}

function Badge({ children, tone = 'neutral' }) { return <span className={`badge ${tone}`}>{children}</span>; }
function Spinner({ small = false }) { return <LoaderCircle className="spin" size={small ? 15 : 22} aria-label="Loading" />; }
function Empty({ icon: Icon = ScanLine, title, children, action }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={28} /></div><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function DetectionImage({ item, boxes = true, crop = false, large = false }) {
  const [x1, y1, x2, y2] = item.bounding_box;
  return <div className={`detection-image ${large ? 'large' : ''}`} style={{ aspectRatio: crop ? '1' : `${item.width}/${item.height}` }}>
    <img src={crop ? item.cropped_url : item.original_url} alt={crop ? `Cropped ${item.class_name} candidate` : `Captured frame ${item.filename}`} loading={large ? 'eager' : 'lazy'} />
    {!crop && boxes && <div className="detection-box" style={{ left: `${x1 / item.width * 100}%`, top: `${y1 / item.height * 100}%`, width: `${(x2 - x1) / item.width * 100}%`, height: `${(y2 - y1) / item.height * 100}%` }}><span>{item.class_name} {percent(item.confidence)}</span></div>}
    {item.is_mock && <span className="image-demo"><span />{item.is_demo ? 'SYNTHETIC DEMO' : 'MOCK DETECTION'}</span>}
  </div>;
}

function ReviewButtons({ item, onReview, busy, compact = false }) {
  if (item.status !== 'pending') return <button className="button secondary full" onClick={() => onReview(item.id, 'reset')} disabled={busy}>{busy ? <Spinner small /> : <RefreshCw size={15} />} Return to pending</button>;
  return <div className={`review-buttons ${compact ? 'small' : ''}`}>
    <button className="button primary" onClick={() => onReview(item.id, 'verify')} disabled={busy}>{busy ? <Spinner small /> : <Check size={16} />} Confirm turtle</button>
    <button className="button reject" onClick={() => onReview(item.id, 'reject')} disabled={busy} aria-label={`Reject detection ${shortId(item.id)}`}><X size={16} /> Reject</button>
  </div>;
}

function DetectionCard({ item, boxes, onOpen, onReview, busy }) {
  return <article className="detection-card panel">
    <button className="image-button" onClick={() => onOpen(item.id)} aria-label={`Inspect detection ${shortId(item.id)}`}><DetectionImage item={item} boxes={boxes} /><span className="inspect-hint"><Focus size={15} /> Inspect frame</span></button>
    <div className="card-content"><div className="row-between"><span className="eyebrow mono">{item.status === 'verified' ? item.sighting_id : `DET-${shortId(item.id)}`}</span><Badge tone={item.status === 'verified' ? 'green' : item.status === 'rejected' ? 'red' : 'amber'}>{item.status === 'pending' ? 'Pending review' : item.status === 'verified' ? 'Verified' : 'Rejected'}</Badge></div>
      <button className="card-title" onClick={() => onOpen(item.id)}>{item.class_name === 'turtle' ? 'Turtle candidate' : item.class_name}<ArrowUpRight size={16} /></button>
      <div className="confidence-line"><span>Model confidence</span><strong>{percent(item.confidence)}</strong></div><div className="confidence-track"><i style={{ width: percent(item.confidence) }} /></div>
      <div className="card-metadata"><span><MapPin size={13} />{coordinates(item)}</span><span><CalendarDays size={13} />{stamp(item.captured_at)}</span></div>
      {item.status === 'verified' && <span className="verification-time"><CheckCheck size={12} /> Verified {stamp(item.reviewed_at)}</span>}
      <ReviewButtons item={item} onReview={onReview} busy={busy} compact />
    </div>
  </article>;
}

function DetailModal({ item, onClose, onReview, busy }) {
  const [view, setView] = useState('frame');
  const [boxes, setBoxes] = useState(true);
  const dialog = useRef(null);
  useEffect(() => {
    dialog.current.showModal();
    const bodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = bodyOverflow; };
  }, []);
  return <dialog ref={dialog} className="detail-modal" aria-labelledby={`detection-title-${item.id}`} onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <div className="modal-header"><div><div className="eyebrow">DETECTION INSPECTOR</div><h2 id={`detection-title-${item.id}`}>{item.status === 'verified' ? item.sighting_id : `DET-${shortId(item.id)}`}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close detection details"><X size={21} /></button></div>
    <div className="modal-grid"><div className="modal-visual"><div className="image-tools"><div className="segmented"><button className={view === 'frame' ? 'active' : ''} onClick={() => setView('frame')}>Full frame</button><button className={view === 'crop' ? 'active' : ''} onClick={() => setView('crop')}>Object crop</button><button className={view === 'annotated' ? 'active' : ''} onClick={() => setView('annotated')}>Annotated</button></div>{view === 'frame' && <label className="checkbox-label"><input type="checkbox" checked={boxes} onChange={e => setBoxes(e.target.checked)} /> Bounding box</label>}</div>
      {view === 'annotated' ? <img className="annotated-preview" src={item.annotated_url} alt="Saved frame with model annotation" /> : <DetectionImage item={item} boxes={boxes} crop={view === 'crop'} large />}
      <div className="image-caption"><FileImage size={14} /><span>{item.filename}</span><span>{item.width} × {item.height} px</span></div>
    </div><div className="modal-info"><Badge tone={item.status === 'verified' ? 'green' : item.status === 'rejected' ? 'red' : 'amber'}>{item.status === 'pending' ? 'Pending review' : item.status === 'verified' ? 'Verified sighting' : 'Rejected detection'}</Badge>
      <h3>{item.class_name === 'turtle' ? 'Potential turtle' : item.class_name}</h3><div className="big-confidence">{percent(item.confidence)}<span>model confidence</span></div>
      {item.is_mock && <div className="notice amber"><CircleHelp size={16} /><span>{item.is_demo ? 'Synthetic image and location for demonstration. This is not a field observation.' : 'Simulated bounding box. No AI inference was run on this image.'}</span></div>}
      <dl className="detail-list"><div><dt>GPS coordinates</dt><dd className="mono">{coordinates(item)}</dd></div><div><dt>Original capture time</dt><dd>{stamp(item.captured_at)}</dd></div><div><dt>Uploaded</dt><dd>{stamp(item.uploaded_at)}</dd></div>{item.reviewed_at && <div><dt>{item.status === 'verified' ? 'Verified' : 'Reviewed'}</dt><dd>{stamp(item.reviewed_at)}</dd></div>}<div><dt>Detection model</dt><dd>{item.model_name}</dd></div><div><dt>Image source</dt><dd>{item.source}</dd></div><div><dt>Metadata source</dt><dd>{Object.entries(item.metadata.provenance || {}).filter(([k]) => k !== 'video_frame').map(([k, v]) => `${k === 'gps' ? 'GPS' : 'Time'}: ${v}`).join(' · ') || 'No embedded metadata'}</dd></div></dl>
      {item.metadata.missing?.length > 0 && <div className="notice"><MapPin size={15} /><span>Missing {item.metadata.missing.map(x => x === 'gps' ? 'GPS coordinates' : 'capture timestamp').join(' and ')}. No replacement values have been generated.</span></div>}
      {item.metadata.warnings?.filter(x => !x.startsWith('Synthetic')).map(warning => <p className="metadata-warning" key={warning}>{warning}</p>)}
      <ReviewButtons item={item} onReview={onReview} busy={busy} />
    </div></div>
  </dialog>;
}

function Overview({ records, stats, navigate, onOpen, onReview, busy }) {
  const pending = records.filter(x => x.status === 'pending');
  const reviewed = records.filter(x => x.reviewed_at).sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at)).slice(0, 4);
  const metrics = [
    ['Total detections', stats.total, ScanLine, `${stats.images} captured images`],
    ['Pending review', stats.pending, Clock3, 'Ready for your review'],
    ['Verified turtles', stats.verified, ShieldCheck, 'Confirmed by a human reviewer'],
    ['Average confidence', percent(stats.average_confidence), Crosshair, 'Across all model candidates'],
  ];
  return <>
    <div className="page-heading overview-heading"><div><div className="eyebrow accent">TURTLE SURVEY</div><h1>Your survey, in focus.</h1><p>Find the next sighting. Review detections, explore the map, or bring in new footage.</p><div className="overview-actions"><button className="button primary" onClick={() => navigate('pending')}><ScanLine size={18} /> Review detections</button><button className="button secondary" onClick={() => navigate('upload')}><Plus size={18} /> Upload media</button></div></div>
      <div className="overview-emblem" aria-hidden="true"><TurtleMark size={94} /></div>
    </div>
    <div className="metrics-grid">{metrics.map(([label, value, Icon, description], i) => <div className={`metric-card panel metric-${i}`} key={label}><div className="row-between"><span>{label}</span><Icon size={18} /></div><strong>{value}</strong><small>{i === 1 && <span className="status-dot amber-dot" />}{description}</small></div>)}</div>
    <div className="overview-columns"><section className="panel review-panel"><div className="section-top"><div><h2>Up next <span className="count-pill">{pending.length}</span></h2><p className="section-description">Continue your review queue</p></div><button className="text-button" onClick={() => navigate('pending')}>View all <ArrowUpRight size={15} /></button></div>
      {pending.length ? <div className="featured-review"><div><button className="image-button featured-image" aria-label="Inspect detection" onClick={() => onOpen(pending[0].id)}><DetectionImage item={pending[0]} /><span className="inspect-hint"><Focus size={16} /> Inspect detection</span></button><div className="featured-caption"><span className="mono">DET-{shortId(pending[0].id)}</span><Badge tone="amber">Pending review</Badge></div></div><div className="featured-info"><div className="eyebrow accent">READY TO REVIEW</div><h3>Turtle candidate</h3><p>Inspect the frame and confirm or reject this candidate.</p><div className="feature-confidence"><strong>{percent(pending[0].confidence)}</strong><span>model confidence</span></div><span className="muted-meta"><MapPin size={14} />{coordinates(pending[0])}</span><ReviewButtons item={pending[0]} onReview={onReview} busy={busy.has(pending[0].id)} /></div></div> : <Empty title="All caught up" icon={CircleCheck}>New detections will appear here when you upload more media.</Empty>}
      {pending.length > 1 && <div className="queue-strip">{pending.slice(1, 4).map(item => <button onClick={() => onOpen(item.id)} key={item.id}><img src={item.cropped_url} alt="Turtle candidate crop" /><span><strong>DET-{shortId(item.id)}</strong><small>{percent(item.confidence)} confidence</small></span><ChevronRight size={15} /></button>)}</div>}
    </section><section className="panel location-panel"><div className="section-top"><div><h2>Verified locations</h2><p className="section-description">Your sightings on the map</p></div><button className="icon-button" onClick={() => navigate('map')} title="Open turtle map" aria-label="Open turtle map"><ArrowUpRight size={18} /></button></div><MapView records={records} onOpen={onOpen} compact /><div className="location-footer"><span><span className="marker-dot" /> Human-verified sightings</span><small>Demo locations are synthetic</small></div><div className="latest-sighting"><span className="eyebrow">LATEST CAPTURED SIGHTING</span><strong>{stats.latest_sighting ? stamp(stats.latest_sighting.captured_at) : 'No capture timestamp available'}</strong></div></section></div>
    <div className="overview-bottom"><section className="panel activity-panel"><div className="section-top"><div><h2>Recent reviews</h2><p className="section-description">The latest from your workspace</p></div><Activity size={18} className="muted" /></div>{reviewed.length ? reviewed.map(item => <button className="activity-row" onClick={() => onOpen(item.id)} key={item.id}><span className={`activity-icon ${item.status === 'verified' ? 'green' : 'red'}`}>{item.status === 'verified' ? <Check size={16} /> : <X size={16} />}</span><span><strong>{item.status === 'verified' ? 'Turtle sighting verified' : 'Detection rejected'}</strong><small>DET-{shortId(item.id)} · {item.is_demo ? 'Synthetic demo' : item.is_mock ? 'Mock detection' : item.model_name}</small></span><time>{stamp(item.reviewed_at)}</time><ChevronRight size={14} /></button>) : <p className="panel-text">Your review activity will appear here.</p>}</section><div className="panel source-panel"><div className="source-icon"><Plane size={27} /></div><div className="eyebrow">YOUR SOURCE</div><h2>DJI Avata 2</h2><p>Import recorded footage, or configure a MediaMTX live preview.</p><div className="source-mode"><span className="status-dot" />Recorded media workflow</div><div className="source-summary"><span>Rejected & retained <strong>{stats.rejected}</strong></span><span>Simulated detections <strong>{stats.mock_detections}</strong></span></div><div className="source-actions"><button className="text-button" onClick={() => navigate('upload')}>Upload media <ArrowRight size={15} /></button><button className="text-button" onClick={() => navigate('live')}>Set up live feed <ArrowUpRight size={15} /></button></div></div></div>
  </>;
}

function exportCSV(records) {
  const columns = ['id', 'sighting_id', 'status', 'confidence', 'latitude', 'longitude', 'captured_at', 'reviewed_at', 'filename', 'model_name', 'source', 'is_mock', 'is_demo'];
  const cell = value => { let text = value == null ? '' : String(value); if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; };
  const blob = new Blob(['\uFEFF' + [columns.join(','), ...records.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'asian-baddies-sightings.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Collection({ kind, records, onOpen, onReview, busy, navigate }) {
  const verified = kind === 'sightings';
  const [status, setStatus] = useState('pending');
  const [search, setSearch] = useState('');
  const [minConfidence, setMinConfidence] = useState(0);
  const [location, setLocation] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [boxes, setBoxes] = useState(true);
  const [filters, setFilters] = useState(false);
  const filtered = useMemo(() => records.filter(item => {
    const query = search.toLowerCase().trim(); const day = item.captured_at?.slice(0, 10);
    return item.status === (verified ? 'verified' : status) && item.confidence >= Number(minConfidence) &&
      (!query || `${item.id} ${item.sighting_id} ${item.filename} ${coordinates(item)}`.toLowerCase().includes(query)) &&
      (location === 'all' || (location === 'located' ? item.latitude != null : item.latitude == null)) &&
      (!from || day && day >= from) && (!to || day && day <= to);
  }).sort((a, b) => sort === 'confidence' ? b.confidence - a.confidence : sort === 'reviewed' ? (b.reviewed_at || '').localeCompare(a.reviewed_at || '') : captureOrder(a, b, sort === 'oldest')), [records, verified, status, search, minConfidence, location, from, to, sort]);
  function clear() { setSearch(''); setMinConfidence(0); setLocation('all'); setFrom(''); setTo(''); }
  return <><div className="page-heading"><div><div className="eyebrow accent">{verified ? 'THE VERIFIED RECORD' : 'HUMAN INSIGHT, MODEL ASSISTED'}</div><h1>{verified ? 'Verified sightings' : 'Pending detections'}<span className="heading-dot">.</span></h1><p>{verified ? 'Every sighting here has been confirmed by a human. A growing record of life on the ground.' : 'A candidate is just the beginning. Your review turns a possibility into a trusted observation.'}</p></div><button className="button secondary" onClick={() => verified ? exportCSV(filtered) : navigate('upload')}>{verified ? <ArrowDownToLine size={16} /> : <Plus size={16} />}{verified ? 'Export sightings' : 'Upload media'}</button></div>
    {!verified && <div className="tabs"><button className={status === 'pending' ? 'active' : ''} onClick={() => setStatus('pending')}>Awaiting review <span>{records.filter(x => x.status === 'pending').length}</span></button><button className={status === 'rejected' ? 'active' : ''} onClick={() => setStatus('rejected')}>Rejected archive <span>{records.filter(x => x.status === 'rejected').length}</span></button></div>}
    <div className="collection-toolbar"><label className="search-field"><Search size={17} /><input placeholder="Search ID, filename, or coordinates…" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search detections" /></label><div className="toolbar-actions"><label className="checkbox-label"><input type="checkbox" checked={boxes} onChange={e => setBoxes(e.target.checked)} /> Show boxes</label><button className={`button secondary ${filters ? 'selected' : ''}`} onClick={() => setFilters(!filters)} aria-expanded={filters}><SlidersHorizontal size={15} />Filters{(Number(minConfidence) > 0 || location !== 'all' || from || to) && <span className="status-dot" />}</button><select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort detections"><option value="newest">Newest capture</option><option value="oldest">Oldest capture</option><option value="confidence">Highest confidence</option>{verified && <option value="reviewed">Recently verified</option>}</select></div></div>
    {filters && <div className="filter-panel panel"><label>Minimum confidence<select value={minConfidence} onChange={e => setMinConfidence(e.target.value)}><option value="0">Any confidence</option><option value="0.7">70% or higher</option><option value="0.85">85% or higher</option><option value="0.95">95% or higher</option></select></label><label>Location<select value={location} onChange={e => setLocation(e.target.value)}><option value="all">All locations</option><option value="located">With GPS coordinates</option><option value="missing">Missing GPS coordinates</option></select></label><label>Captured from<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Captured through<input type="date" value={to} onChange={e => setTo(e.target.value)} min={from} /></label><button className="text-button" onClick={clear}>Clear filters</button></div>}
    <div className="results-line"><span>{filtered.length} {verified ? 'verified sightings' : status === 'rejected' ? 'retained detections' : 'candidates to review'}</span><span><span className="status-dot" /> Changes saved locally</span></div>
    {filtered.length ? <div className="detections-grid">{filtered.map(item => <DetectionCard item={item} boxes={boxes} onOpen={onOpen} onReview={onReview} busy={busy.has(item.id)} key={item.id} />)}</div> : <div className="panel"><Empty icon={verified ? ShieldCheck : CircleCheck} title={search || from || to || Number(minConfidence) || location !== 'all' ? 'No matching detections' : verified ? 'Your sighting record starts here' : status === 'rejected' ? 'No rejected detections' : 'The review queue is clear'} action={<button className="button secondary" onClick={() => search || from || to || Number(minConfidence) || location !== 'all' ? clear() : navigate(verified ? 'pending' : 'upload')}>{search || from || to || Number(minConfidence) || location !== 'all' ? 'Clear filters' : verified ? 'Review candidates' : 'Upload media'}</button>}>{verified ? 'Confirm a turtle candidate to add it to this record.' : 'New candidates appear after image or video processing.'}</Empty></div>}
  </>;
}

function TurtleMapPage({ records, onOpen, navigate }) {
  const verified = records.filter(x => x.status === 'verified'); const missing = verified.filter(x => x.latitude == null);
  return <><div className="page-heading"><div><div className="eyebrow accent">A GEOGRAPHY OF DISCOVERY</div><h1>Turtle map<span className="heading-dot">.</span></h1><p>Human-verified sightings, placed where they were captured.</p></div><button className="button secondary" onClick={() => navigate('sightings')}>View sighting record <ArrowUpRight size={16} /></button></div><div className="map-stat-row"><span><i className="marker-dot" />{verified.length - missing.length} located sightings</span><span><MapPin size={15} />{missing.length} without GPS</span><span><Eye size={15} />Synthetic demo locations are labeled in popups</span></div><div className="panel full-map"><MapView records={records} onOpen={onOpen} /></div>{missing.length > 0 && <section className="panel missing-locations"><div><MapPin size={22} /><div><h3>Some sightings have no location</h3><p>They remain in your verified record and are excluded from the map.</p></div></div><div>{missing.map(item => <button className="button secondary" key={item.id} onClick={() => onOpen(item.id)}>{item.sighting_id}<ArrowUpRight size={14} /></button>)}</div></section>}</>;
}

function UploadPage({ settings, jobs, refresh, navigate, toast }) {
  const [kind, setKind] = useState('images'); const [files, setFiles] = useState([]); const [telemetry, setTelemetry] = useState(null);
  const [latitude, setLatitude] = useState(''); const [longitude, setLongitude] = useState(''); const [captured, setCaptured] = useState('');
  const [zone, setZone] = useState(''); const [interval, setIntervalValue] = useState(settings.frame_interval_seconds); const [maxFrames, setMaxFrames] = useState(settings.max_frames);
  const [working, setWorking] = useState(false); const [dragging, setDragging] = useState(false); const [results, setResults] = useState([]);
  const picker = useRef(null); const video = kind === 'video';
  function selectFiles(list) { const selection = Array.from(list); setFiles(video ? selection.slice(0, 1) : selection); setResults([]); }
  function switchKind(next) { setKind(next); setFiles([]); setResults([]); }
  async function submit(event) {
    event.preventDefault();
    if (!files.length) { toast('Choose media files first.', 'error'); return; }
    if ((latitude === '') !== (longitude === '')) { toast('Supply both GPS coordinates, or leave both empty.', 'error'); return; }
    if (captured && zone.trim() && !/^[+-](0\d|1[0-4]):[0-5]\d$/.test(zone.trim()) && zone.trim() !== 'Z') { toast('Use a timezone offset such as -04:00, +00:00, or Z.', 'error'); return; }
    setWorking(true); setResults([]); let success = 0; const failedFiles = [];
    for (const file of files) {
      const form = new FormData(); form.append('file', file);
      const metadata = {}; if (latitude !== '') { metadata.latitude = Number(latitude); metadata.longitude = Number(longitude); } if (captured) metadata.captured_at = `${captured}${zone.trim()}`;
      form.append('metadata', JSON.stringify(metadata));
      if (video) { form.append('frame_interval_seconds', interval); form.append('max_frames', maxFrames); if (telemetry) form.append('telemetry', telemetry); }
      try { const result = await api.upload(form, video); success++; setResults(current => [...current, { name: file.name, message: video ? 'Video queued. Follow frame processing below.' : `${result.detections.length} ${result.is_mock ? 'simulated' : 'model'} candidates created.`, ok: true }]); }
      catch (error) { failedFiles.push(file); setResults(current => [...current, { name: file.name, message: error.message, ok: false }]); }
    }
    if (success) { await refresh(true); toast(video ? 'Video submitted for frame processing.' : 'Media saved. Candidates are ready to review.'); }
    setFiles(failedFiles); setWorking(false);
  }
  return <><div className="page-heading"><div><div className="eyebrow accent">FROM THE FIELD TO THE RECORD</div><h1>Bring your survey in<span className="heading-dot">.</span></h1><p>Upload photographs or recorded DJI Avata 2 footage. No connected drone required.</p></div></div><div className="upload-layout"><form onSubmit={submit} className="panel upload-form"><div className="section-top"><div><span className="eyebrow">01 / YOUR MEDIA</span><h2>A new perspective</h2></div><div className="segmented"><button type="button" className={!video ? 'active' : ''} onClick={() => switchKind('images')} disabled={working}><FileImage size={15} />Photos</button><button type="button" className={video ? 'active' : ''} onClick={() => switchKind('video')} disabled={working}><Film size={15} />Video</button></div></div>
      <input ref={picker} className="sr-only" type="file" accept={video ? '.mp4,.mov,.avi,.mkv' : 'image/jpeg,image/png,image/webp,image/tiff,image/bmp'} multiple={!video} onChange={e => { selectFiles(e.target.files); e.target.value = ''; }} aria-label={video ? 'Choose video' : 'Choose photos'} disabled={working} />
      <button type="button" className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => picker.current.click()} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!working) selectFiles(e.dataTransfer.files); }} disabled={working}><span className="upload-icon">{video ? <Film size={30} /> : <ImagePlus size={30} />}</span><strong>Drop your {video ? 'recording' : 'photographs'} here</strong><span>or <u>browse files</u> on your computer</span><small>{video ? 'MP4, MOV, AVI, MKV · up to 1 GB by default' : 'JPG, PNG, WebP, TIFF, BMP · 50 MB / 40 MP per image'}</small></button>
      {files.length > 0 && <div className="selected-files">{files.map((file, index) => <div key={`${file.name}-${index}`}><FileImage size={17} /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span><button type="button" className="icon-button" onClick={() => setFiles(files.filter((_, i) => i !== index))} disabled={working} aria-label={`Remove ${file.name}`}><X size={16} /></button></div>)}</div>}
      {video && <div className="video-options"><h3>Frame selection</h3><p>Sample the recording at a fixed interval. Every candidate can be reviewed independently.</p><div className="form-grid"><label>Extract one frame every (seconds)<input type="number" step="0.25" min="0.25" max="3600" required value={interval} onChange={e => setIntervalValue(e.target.value)} /></label><label>Maximum selected frames<input type="number" min="1" max="1000" required value={maxFrames} onChange={e => setMaxFrames(e.target.value)} /></label></div><label className="file-field">External telemetry <span className="optional">OPTIONAL · CSV / SRT</span><input type="file" accept=".csv,.srt" onChange={e => setTelemetry(e.target.files[0] || null)} /></label><p className="help-text">CSV: offset_seconds, latitude, longitude, captured_at. SRT reads recognized DJI fields; formats can vary. Closest telemetry sample must be within 2 seconds by default.</p></div>}
      <div className="metadata-form"><div className="eyebrow">02 / CAPTURE METADATA <span className="optional">OPTIONAL</span></div><h3>Keep the original context</h3><p>Embedded metadata is read automatically. Supplied values override embedded data. For video, telemetry overrides matched frame metadata.</p><div className="form-grid"><label>Latitude<input type="number" min="-90" max="90" step="any" placeholder="e.g. 35.91920" value={latitude} onChange={e => setLatitude(e.target.value)} /></label><label>Longitude<input type="number" min="-180" max="180" step="any" placeholder="e.g. -78.96280" value={longitude} onChange={e => setLongitude(e.target.value)} /></label><label>{video ? 'Original recording start' : 'Original capture time'}<input type="datetime-local" step="1" value={captured} onChange={e => setCaptured(e.target.value)} /></label><label>Capture timezone offset<input type="text" aria-label="Capture timezone offset" placeholder="Unknown, or e.g. -04:00" value={zone} onChange={e => setZone(e.target.value)} /><small>Leave blank if the camera timezone is unknown.</small></label></div><div className="notice"><MapPin size={16} /><span>Missing GPS and capture time stay missing. Upload time is recorded separately.</span></div></div>
      <div className="upload-submit"><span>{files.length ? `${files.length} ${video ? 'recording' : 'photos'} selected` : 'Choose files to get started'}</span><button className="button primary" type="submit" disabled={working || !files.length}>{working ? <Spinner small /> : <ScanLine size={17} />}{working ? 'Saving media…' : video ? 'Extract & process frames' : 'Process photographs'}</button></div>
      {results.length > 0 && <div className="upload-results" aria-live="polite">{results.map((result, index) => <div className={result.ok ? 'success' : 'failure'} key={index}>{result.ok ? <CircleCheck size={18} /> : <XCircle size={18} />}<span><strong>{result.name}</strong>{result.message}</span></div>)}{results.some(x => x.ok) && <button type="button" className="text-button" onClick={() => navigate('pending')}>Open pending detections <ArrowRight size={15} /></button>}</div>}
    </form><aside className="upload-aside"><section className="panel engine-note"><div className="source-icon"><Cpu size={24} /></div><div className="eyebrow">ACTIVE DETECTION ENGINE</div><h3>{settings.active_model_id === 'demo' ? 'Demo simulator' : 'Local YOLO model'}</h3><Badge tone={settings.active_model_id === 'demo' ? 'amber' : 'green'}>{settings.active_model_id === 'demo' ? 'Mock inference' : 'Local CPU inference'}</Badge><p>{settings.active_model_id === 'demo' ? 'Try the complete workflow without a model. Simulated boxes do not identify actual turtles in your images.' : 'Images are processed on this computer using your selected .pt model.'}</p><div className="engine-threshold"><span>Confidence threshold</span><strong>{percent(settings.confidence_threshold)}</strong></div><button type="button" className="text-button" onClick={() => navigate('settings')}>Configure engine <ArrowUpRight size={15} /></button></section><section className="panel process-note"><div className="eyebrow">HOW IT WORKS</div>{[['01', 'Preserve', 'Save the image and its original capture metadata.'], ['02', 'Detect', 'Run the active engine on images or selected frames.'], ['03', 'Review', 'A human confirms or rejects every candidate.']].map(([n, title, text]) => <div key={n}><span>{n}</span><div><h4>{title}</h4><p>{text}</p></div></div>)}</section><div className="local-note"><ShieldCheck size={17} /><span>Files and detections stay on this computer. No cloud inference or paid API calls.</span></div></aside></div>
    {jobs.length > 0 && <section className="panel jobs-panel"><div className="section-top"><div><div className="eyebrow">RECORDED FOOTAGE</div><h2>Video processing</h2></div><Film size={20} /></div>{jobs.map(job => <div className="job" key={job.id}><div className="row-between"><strong>{job.filename}</strong><Badge tone={job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : 'amber'}>{['processing', 'queued'].includes(job.status) && <Spinner small />}{job.status}</Badge></div><div className="confidence-track"><i style={{ width: `${job.total_frames ? job.processed_frames / job.total_frames * 100 : 0}%` }} /></div><div className="job-details"><span>{job.processed_frames} / {job.total_frames || '—'} frames · {job.detections_created} candidates</span><span>{job.settings_snapshot.is_mock ? 'Demo simulator' : job.settings_snapshot.model_name} · every {job.settings_snapshot.frame_interval_seconds}s</span></div>{job.error && <p className="error-text">{job.error}</p>}{job.warnings?.map(x => <p className="help-text" key={x}>{x}</p>)}</div>)}</section>}
  </>;
}

function SettingsPage({ settings, setSettings, models, reloadModels, toast }) {
  const [draft, setDraft] = useState(settings); const [saving, setSaving] = useState(false); const [registering, setRegistering] = useState(false);
  const [name, setName] = useState(''); const [path, setPath] = useState(''); const [labels, setLabels] = useState('turtle');
  useEffect(() => setDraft(settings), [settings]);
  async function save(event) { event.preventDefault(); setSaving(true); try { const result = await api.saveSettings({ ...draft, confidence_threshold: Number(draft.confidence_threshold), frame_interval_seconds: Number(draft.frame_interval_seconds), max_frames: Number(draft.max_frames) }); setSettings(result); toast('Detection settings saved. New uploads will use these values.'); } catch (error) { toast(error.message, 'error'); } finally { setSaving(false); } }
  async function register(event) { event.preventDefault(); setRegistering(true); try { await api.addModel({ name, path, labels: labels.split(',').map(x => x.trim()).filter(Boolean) }); await reloadModels(); toast('Model registered. Select it above to activate.'); setName(''); setPath(''); } catch (error) { toast(error.message, 'error'); } finally { setRegistering(false); } }
  return <><div className="page-heading"><div><div className="eyebrow accent">YOUR SURVEY, YOUR SETUP</div><h1>Settings<span className="heading-dot">.</span></h1><p>Upgrade the model. Keep your workflow. Configure how new media becomes reviewable detections.</p></div><Badge tone="green"><span className="status-dot" />LOCAL WORKSPACE</Badge></div><div className="settings-layout"><div><form className="panel settings-panel" onSubmit={save}><div className="section-top"><div><span className="eyebrow">DETECTION ENGINE</span><h2>A model that can evolve</h2></div><Cpu size={23} /></div><p>Choose the adapter used for new uploads. Existing detections retain their original model, scores, and review status.</p><div className="model-options">{models.map(model => <label className={`model-option ${draft.active_model_id === model.id ? 'chosen' : ''}`} key={model.id}><input type="radio" name="active-model" checked={draft.active_model_id === model.id} value={model.id} onChange={() => setDraft({ ...draft, active_model_id: model.id })} disabled={!model.available} /><span className="model-icon">{model.kind === 'demo' ? <Sprout size={23} /> : <Cpu size={23} />}</span><span><strong>{model.name}</strong><small>{model.kind === 'demo' ? 'Simulated detections · no model file needed' : model.path}</small></span><Badge tone={!model.available ? 'red' : model.kind === 'demo' ? 'amber' : 'green'}>{!model.available ? 'File missing' : model.kind === 'demo' ? 'Demo' : 'YOLO .pt'}</Badge></label>)}</div><div className="threshold-control"><div className="row-between"><label htmlFor="confidence-threshold">Confidence threshold</label><strong>{percent(Number(draft.confidence_threshold))}</strong></div><input id="confidence-threshold" type="range" min="0.01" max="1" step="0.01" value={draft.confidence_threshold} onChange={e => setDraft({ ...draft, confidence_threshold: Number(e.target.value) })} /><div className="range-labels"><span>More candidates · 1%</span><span>Higher certainty · 100%</span></div><p className="help-text">Only candidates at or above this threshold enter the queue. Demo simulation emits a fixed 87% candidate.</p></div><div className="video-defaults"><h3>Recorded video defaults</h3><div className="form-grid"><label>Frame interval (seconds)<input type="number" min="0.25" max="3600" step="0.25" value={draft.frame_interval_seconds} onChange={e => setDraft({ ...draft, frame_interval_seconds: e.target.value })} required /></label><label>Maximum selected frames<input type="number" min="1" max="1000" value={draft.max_frames} onChange={e => setDraft({ ...draft, max_frames: e.target.value })} required /></label></div></div><div className="settings-save"><span><ShieldCheck size={14} />Stored in local SQLite</span><button className="button primary" disabled={saving}>{saving ? <Spinner small /> : <Check size={16} />}Save settings</button></div></form><form className="panel register-panel" onSubmit={register}><div className="section-top"><div><span className="eyebrow">MODEL LIBRARY</span><h2>Register a local model</h2></div><Plus size={22} /></div><p>Add an existing custom YOLO .pt file from the backend computer. The dashboard and database use the same detection format for every model.</p><label>Model name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Box turtle · woodland v2" required maxLength={100} /></label><label>Local model path<input value={path} onChange={e => setPath(e.target.value)} placeholder="C:\models\turtle-v2.pt or /home/user/models/turtle.pt" required /></label><label>Candidate class labels<input value={labels} onChange={e => setLabels(e.target.value)} placeholder="turtle, box turtle" /><small>Comma separated, case insensitive. Leave empty to accept every class.</small></label><div className="notice"><FolderOpen size={16} /><span>Local inference requires the optional packages in requirements-yolo.txt. Model files are never downloaded automatically.</span></div><button className="button secondary" disabled={registering}>{registering ? <Spinner small /> : <Plus size={16} />}Register model</button></form></div><aside><section className="panel source-config"><span className="source-icon"><Plane size={26} /></span><div className="eyebrow">DRONE SOURCE</div><h2>DJI Avata 2</h2><Badge>Recorded media + live preview</Badge><p>Review saved photos and videos, or open a MediaMTX video preview on the Live feed page.</p><a className="text-button" href="#live">Configure live feed <ArrowUpRight size={17} /></a><dl className="detail-list"><div><dt>Image ingestion</dt><dd>Upload or frame API</dd></div><div><dt>Video ingestion</dt><dd>Selected recorded frames</dd></div><div><dt>Telemetry</dt><dd>Embedded tags, CSV, SRT</dd></div><div><dt>Future adapters</dt><dd>Network frames, ROS 2, companion computers</dd></div></dl></section><div className="architecture-note"><Boxes size={22} /><h3>Independent by design</h3><p>The detection adapter and image source meet at a common frame contract. Changing either one keeps the review workflow intact.</p></div><div className="local-note"><ShieldCheck size={18} /><span>No paid integrations, cloud inference, or billing connections are configured.</span></div></aside></div></>;
}

export default function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f5f6f5' : '#121212');
    try { localStorage.setItem('asian-baddies-theme', theme); } catch { /* Appearance still works with browser storage disabled. */ }
  }, [theme]);
  const [textSize, setTextSize] = useState(() => {
    try { const saved = Number(localStorage.getItem('terrapin-text-size')); return [16, 18, 20].includes(saved) ? saved : 18; }
    catch { return 18; }
  });
  useEffect(() => {
    document.documentElement.style.fontSize = `${textSize}px`;
    try { localStorage.setItem('terrapin-text-size', String(textSize)); } catch { /* Browser storage can be disabled. */ }
  }, [textSize]);
  const [page, setPage] = useState(() => NAV.some(x => x[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard');
  const [records, setRecords] = useState([]); const [stats, setStats] = useState(null); const [settings, setSettings] = useState(null);
  const [models, setModels] = useState([]); const [jobs, setJobs] = useState([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(null); const [busy, setBusy] = useState(new Set()); const [notification, setNotification] = useState(null); const [mobileNav, setMobileNav] = useState(false);
  const revision = useRef(0); const fetching = useRef(null); const hydrated = useRef(false);
  const toast = useCallback((message, tone = 'success') => setNotification({ message, tone, id: Date.now() }), []);
  useEffect(() => { if (notification) { const timer = setTimeout(() => setNotification(null), 6500); return () => clearTimeout(timer); } }, [notification]);
  const refresh = useCallback((silent = false, force = false) => {
    if (fetching.current) return force ? fetching.current.then(() => refresh(silent, true)) : fetching.current;
    const version = revision.current;
    const operation = (async () => {
      try {
        const [items, metrics, options, library, tasks] = await Promise.all([api.detections(), api.stats(), api.settings(), api.models(), api.jobs()]);
        if (version === revision.current) {
          setRecords(current => JSON.stringify(current) === JSON.stringify(items) ? current : items);
          setStats(metrics);
          setSettings(current => JSON.stringify(current) === JSON.stringify(options) ? current : options);
          setModels(library); setJobs(tasks); hydrated.current = true;
          setError('');
        }
      } catch (err) { setError(err.message); if (!silent && hydrated.current) toast(err.message, 'error'); }
      finally { setLoading(false); fetching.current = null; }
    })();
    fetching.current = operation;
    return operation;
  }, [toast]);
  const settingsSaved = useCallback(value => { revision.current++; setSettings(value); }, []);
  const mediaSaved = useCallback(() => { revision.current++; return refresh(true, true); }, [refresh]);
  useEffect(() => { refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(true); }, 5000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const handler = () => { const hash = location.hash.slice(1); if (NAV.some(x => x[0] === hash)) { setPage(hash); setMobileNav(false); } }; window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  const navigate = useCallback(next => { location.hash = next; setPage(next); setMobileNav(false); window.scrollTo({ top: 0 }); }, []);
  async function onReview(id, action) {
    if (busy.has(id)) return;
    setBusy(current => new Set(current).add(id)); revision.current++;
    try {
      const result = await api.review(id, action); revision.current++;
      setRecords(current => current.map(x => x.id === id ? result : x));
      if (action !== 'reset') setSelectedId(null);
      toast(action === 'verify' ? 'Turtle confirmed. Sighting added to the verified record.' : action === 'reject' ? 'Detection rejected and retained in the archive.' : 'Detection returned to the review queue.');
      const savedRevision = revision.current;
      try { const metrics = await api.stats(); if (savedRevision === revision.current) setStats(metrics); }
      catch { setError('Your review was saved. Dashboard totals could not refresh; use Retry to synchronize them.'); }
    } catch (err) { toast(err.message, 'error'); await refresh(true, true); }
    finally { setBusy(current => { const next = new Set(current); next.delete(id); return next; }); }
  }
  const selected = records.find(x => x.id === selectedId);
  const pageLabel = NAV.find(x => x[0] === page)?.[1];
  return <div className="app-shell">
    {mobileNav && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <button className="brand" aria-label="Asian Baddies home" onClick={() => navigate('dashboard')}><span className="brand-mark"><TurtleMark size={30} /></span><span>Asian Baddies<small>Turtle survey workspace</small></span></button>
      <div className="nav-label eyebrow">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">{NAV.map(([key, label, Icon]) => <button key={key} className={`nav-item ${page === key ? 'active' : ''}`} onClick={() => navigate(key)} aria-current={page === key ? 'page' : undefined}><Icon size={21} /><span>{label}</span>{key === 'pending' && stats?.pending > 0 && <span className="nav-count">{stats.pending}</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="sidebar-survey"><Plane size={21} /><strong>DJI Avata 2</strong><span>Recorded photos & footage</span><div><span className="status-dot amber-dot" />No live drone connected</div><button className="text-button" onClick={() => navigate('live')}>Source setup <ArrowUpRight size={14} /></button></div>
        <button className="sidebar-engine" onClick={() => navigate('settings')}><span className="engine-status"><Cpu size={17} /></span><span><strong>{settings?.active_model_id === 'demo' ? 'Demo mode active' : settings ? 'Local model active' : 'Connecting to backend'}</strong><small>{settings?.active_model_id === 'demo' ? 'Simulated detections' : 'Local workspace · no cloud AI'}</small></span><ChevronRight size={15} /></button>
        <div className="sidebar-footer"><span className="status-dot" />Stored on this computer</div>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={21} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{pageLabel}</strong></div><div className="topbar-right"><button className="theme-toggle" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={theme === 'light'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}<span>{theme === 'dark' ? 'Dark' : 'Light'}</span></button><label className="text-size-control"><span>Text size</span><select aria-label="Text size" value={textSize} onChange={event => setTextSize(Number(event.target.value))}><option value="16">Standard</option><option value="18">Large</option><option value="20">Extra large</option></select></label><span className="saved-status"><span className={`status-dot ${error ? 'amber-dot' : ''}`} />{error ? 'Sync needs retry' : 'Local storage'}</span><span className="topbar-separator"/><span className="researcher-avatar">TS</span></div></header><main>
      {error && <div className="error-banner" role="alert"><XCircle size={18} /><span>{error}</span><button className="text-button" onClick={() => refresh(false, true)}>Retry <RefreshCw size={14} /></button></div>}
      {loading ? <div className="initial-loading"><Spinner /><h2>Opening your field workspace…</h2></div> : !stats || !settings ? <Empty title="Start the local backend" icon={Cpu} action={<button className="button primary" onClick={() => refresh()}>Try connection again</button>}>Run the project launcher or start FastAPI, then reconnect.</Empty> : <>
        {settings.active_model_id === 'demo' && <div className="demo-banner"><span className="demo-symbol"><Sprout size={15} /></span><span><strong>Demo workspace</strong><span className="demo-banner-detail"> · Mock detections. Synthetic sample imagery and locations.</span></span><button onClick={() => navigate('settings')}>Configure model <ArrowUpRight size={13} /></button></div>}
        {page === 'dashboard' && <Overview records={records} stats={stats} navigate={navigate} onOpen={setSelectedId} onReview={onReview} busy={busy} />}
        {['pending', 'sightings'].includes(page) && <Collection key={page} kind={page} records={records} onOpen={setSelectedId} onReview={onReview} busy={busy} navigate={navigate} />}
        {page === 'map' && <TurtleMapPage records={records} onOpen={setSelectedId} navigate={navigate} />}
        {page === 'upload' && <UploadPage settings={settings} jobs={jobs} refresh={mediaSaved} navigate={navigate} toast={toast} />}
        {page === 'live' && <LiveFeed toast={toast} navigate={navigate} />}
        {page === 'settings' && <SettingsPage settings={settings} setSettings={settingsSaved} models={models} reloadModels={async () => setModels(await api.models())} toast={toast} />}
      </>}
      <footer className="main-footer"><span><TurtleMark size={19} />ASIAN BADDIES <span>/</span> Turtle survey workspace</span><span>Human insight. Better observations.</span></footer>
    </main></div>
    {selected && <DetailModal key={selected.id} item={selected} onClose={() => setSelectedId(null)} onReview={onReview} busy={busy.has(selected.id)} />}
    {notification && <div className={`toast ${notification.tone}`} role={notification.tone === 'error' ? 'alert' : 'status'}>{notification.tone === 'error' ? <XCircle size={19} /> : <CircleCheck size={19} />}<span>{notification.message}</span><button className="icon-button" onClick={() => setNotification(null)} aria-label="Dismiss notification"><X size={15} /></button></div>}
  </div>;
}
