import InfoHint from './InfoHint.jsx';

export default function SamplingFields({ prefix, interval, maxFrames, onInterval, onMaxFrames, intervalLabel = 'Frame interval (seconds)' }) {
  return <>
    <div className="field-with-help"><div className="field-label-row"><label htmlFor={`${prefix}-interval`}>{intervalLabel}</label><InfoHint label="frame interval"><strong>How much video to skip between images.</strong> At 5 seconds, the app checks one still image every 5 seconds of the recording, or about 12 frames per minute of video. Smaller intervals check more frames and take more processing time; larger intervals check fewer frames.</InfoHint></div><input id={`${prefix}-interval`} type="number" min="0.25" max="3600" step="0.25" required value={interval} onChange={event => onInterval(event.target.value)} /></div>
    <div className="field-with-help"><div className="field-label-row"><label htmlFor={`${prefix}-limit`}>Maximum selected frames</label><InfoHint label="maximum selected frames"><strong>A limit on how many images to process from one video.</strong> A limit of 60 checks at most 60 sampled frames, stopping sooner if the video ends. This counts frames, not turtles. Each frame can produce zero, one, or several candidates.</InfoHint></div><input id={`${prefix}-limit`} type="number" min="1" max="1000" step="1" required value={maxFrames} onChange={event => onMaxFrames(event.target.value)} /></div>
  </>;
}
