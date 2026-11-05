import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Cable, Check, CircleHelp, ExternalLink, LoaderCircle, MonitorPlay, Play, Radio, RefreshCw, Smartphone, Square } from 'lucide-react';
import { api } from './api.js';

export default function LiveFeed({ toast, navigate }) {
  const [draft, setDraft] = useState({ playback_url: '', transport: 'webrtc' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    api.liveSource().then(value => { if (mounted) setDraft({ playback_url: value.playback_url, transport: value.transport }); })
      .catch(err => { if (mounted) setError(err.message); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  async function save(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const value = await api.saveLiveSource(draft);
      setDraft({ playback_url: value.playback_url, transport: value.transport });
      toast('Live source saved. Open the preview when your publisher is ready.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  function changeTransport(transport) {
    setDraft(current => {
      let playback_url = current.playback_url;
      try {
        const url = new URL(playback_url);
        if (['8888', '8889'].includes(url.port)) {
          url.port = transport === 'webrtc' ? '8889' : '8888';
          playback_url = url.toString();
        }
      } catch { /* An empty or partially typed address can be completed later. */ }
      return { ...current, transport, playback_url };
    });
  }

  function openPreview() {
    try {
      const address = draft.playback_url.trim();
      const url = new URL(address);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS MediaMTX player URL.');
      if (/\s/.test(address)) throw new Error('Enter a valid MediaMTX HTTP or HTTPS player address.');
      if (url.username || url.password) throw new Error('Leave credentials out of the player URL.');
      if (!url.pathname.replace(/\//g, '')) throw new Error('Include the stream path, for example http://127.0.0.1:8889/turtle.');
      if (/\.m3u8$|\/whep$/i.test(url.pathname)) throw new Error('Use the MediaMTX browser player page, not a playlist or WHEP endpoint.');
      if (location.protocol === 'https:' && url.protocol === 'http:') throw new Error('This page uses HTTPS. Use an HTTPS player to avoid mixed-content blocking.');
      url.searchParams.set('autoplay', 'true'); url.searchParams.set('muted', 'true'); url.searchParams.set('controls', 'true'); url.searchParams.set('playsInline', 'true');
      setPreview(url.toString()); setAttempt(value => value + 1); setError('');
    } catch (err) { setError(err.message || 'Enter a valid MediaMTX player address first.'); }
  }

  return <>
    <div className="page-heading"><div><div className="eyebrow accent">LIVE SOURCE WORKSPACE</div><h1>Live feed<span className="heading-dot">.</span></h1><p>View a stream relayed by MediaMTX on your computer. Connect the video source first, then open its player here.</p></div><span className="badge amber"><Radio size={14} />{preview ? 'Preview requested' : 'No preview open'}</span></div>
    <div className="notice live-setup-note"><CircleHelp size={20} /><span><strong>Your setup: DJI Avata 2 · Goggles N3 · Android</strong>Use a USB-C data cable from the N3 goggles to your phone and open DJI Fly to view the feed. MediaMTX needs a publisher or capture bridge to receive that video on your computer.</span></div>
    <div className="live-layout">
      <section className="panel live-player-panel"><div className="section-top"><div><div className="eyebrow">VIDEO PREVIEW</div><h2>See what the source is sending</h2></div><MonitorPlay size={24} /></div>
        <div className="live-player">
          {preview ? <iframe key={`${preview}-${attempt}`} src={preview} title="MediaMTX live video player" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin" /> : <div className="live-placeholder"><span><MonitorPlay size={48} /></span><h3>Your live view goes here</h3><p>Start MediaMTX and publish a feed, then enter the player address and select Open preview.</p><span className="badge">Waiting for your video source</span></div>}
        </div>
        <div className="live-player-actions"><span>{preview ? 'Playback and connection messages appear inside the MediaMTX player.' : 'The player opens only when you request it.'}</span><div>{preview && <><button className="button secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16} />Reload player</button><button className="button secondary" onClick={() => setPreview('')}><Square size={15} />Stop preview</button></>}</div></div>
        <div className="notice live-inference-note"><ScanIcon /><span><strong>Viewing is separate from turtle detection.</strong>This page displays video only. Live inference is not running. Recorded videos can already be processed from Upload media; a future frame bridge can submit live frames through the existing ingestion API.</span></div>
        <button className="text-button live-upload-link" onClick={() => navigate('upload')}>Process recorded footage <ArrowRight size={17} /></button>
      </section>
      <form className="panel live-config" onSubmit={save}><div className="section-top"><div><div className="eyebrow">SOURCE CONNECTION</div><h2>MediaMTX player</h2></div><Cable size={24} /></div>
        {loading ? <p className="live-loading"><LoaderCircle className="spin" size={20} />Loading saved source…</p> : <><label>Playback method<select value={draft.transport} onChange={e => changeTransport(e.target.value)}><option value="webrtc">WebRTC · lower latency</option><option value="hls">HLS · easier connectivity</option></select></label><label>Browser player address<input type="url" value={draft.playback_url} onChange={e => setDraft({ ...draft, playback_url: e.target.value })} placeholder={draft.transport === 'webrtc' ? 'http://127.0.0.1:8889/turtle' : 'http://127.0.0.1:8888/turtle'} /></label><p className="help-text">Use the browser player page, not an RTSP/RTMP URL or an .m3u8 playlist. Standard MediaMTX ports are 8889 for WebRTC and 8888 for HLS.</p><button type="button" className="text-button" onClick={() => setDraft({ ...draft, playback_url: `http://127.0.0.1:${draft.transport === 'webrtc' ? '8889' : '8888'}/turtle` })}>Use local example <ArrowUpRight size={16} /></button>
          {error && <div className="notice amber" role="alert">{error}</div>}
          <div className="live-config-buttons"><button className="button secondary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Save source</button><button className="button primary" type="button" disabled={!draft.playback_url} onClick={openPreview}><Play size={17} />Open preview</button></div>
          {draft.playback_url && /^https?:\/\//i.test(draft.playback_url) && <a className="text-button external-player" href={draft.playback_url} target="_blank" rel="noopener noreferrer">Open player in a new tab <ExternalLink size={16} /></a>}
        </>}
        <div className="live-status-list"><div><span>Drone connection</span><strong>Not verified</strong></div><div><span>Live inference</span><strong>Off</strong></div><div><span>GPS / capture time</span><strong>Needs source telemetry</strong></div></div>
      </form>
    </div>
    <section className="panel live-connection-guide"><div className="section-top"><div><div className="eyebrow">HOW YOUR VIDEO REACHES THIS PAGE</div><h2>One feed, four steps</h2></div><Smartphone size={24} /></div><ol className="connection-steps"><li><span>01</span><h3>Goggles → Android</h3><p>Connect N3 to DJI Fly with a USB-C data cable. If needed, enable OTG Wired Connection to Mobile Device in the goggles.</p></li><li><span>02</span><h3>Android → computer</h3><p>Use a supported publishing option, or mirror the phone over Wi-Fi and capture it in OBS. A phone live view alone is not a network stream.</p></li><li><span>03</span><h3>Publish to MediaMTX</h3><p>Send the video from your publisher to a MediaMTX stream path such as turtle. MediaMTX relays it to a browser player.</p></li><li><span>04</span><h3>Open in Asian Baddies</h3><p>Save the WebRTC or HLS player address above. Open the preview and use the player’s own playback controls.</p></li></ol><div className="live-guide-links"><a href="https://www.dji.com/support/product/goggles-n3" target="_blank" rel="noopener noreferrer">DJI N3 live-view sharing <ArrowUpRight size={16} /></a><a href="https://mediamtx.org/docs/read/web-browsers" target="_blank" rel="noopener noreferrer">MediaMTX browser playback <ArrowUpRight size={16} /></a></div></section>
  </>;
}

function ScanIcon() { return <Radio size={20} />; }
