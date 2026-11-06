import { useId, useState } from 'react';
import { Info } from 'lucide-react';
import './info-hint.css';

export default function InfoHint({ label, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <span className="info-hint" onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }}>
    <button type="button" className="info-hint-button" aria-label={`About ${label}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}><Info size={17} /></button>
    {open && <span id={id} className="info-hint-panel" role="note" aria-label={`${label} explained`}>{children}</span>}
  </span>;
}
