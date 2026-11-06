import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react';

export function FileSelection({ item, checked, onToggle, disabled, compact = false }) {
  return <label className={`file-selection ${compact ? 'compact' : ''}`}><input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} disabled={disabled} aria-label={`Select detection ${item.id.slice(0, 8).toUpperCase()}`} />{!compact && <span>Select file</span>}</label>;
}

export function SelectionToolbar({ count, photoCount, total, allSelected, partiallySelected, onSelectAll, onClear, status, onReview, onDelete, working, deleteBlocked }) {
  const selectAll = useRef(null);
  useEffect(() => { selectAll.current.indeterminate = partiallySelected; }, [partiallySelected]);
  return <div className="collection-selection-bar">
    <div className="selection-summary"><label className="file-selection"><input ref={selectAll} type="checkbox" checked={allSelected} onChange={onSelectAll} disabled={!total || working} aria-label="Select all matching detections" /><span>Select all matching</span></label><span aria-live="polite">{count ? `${count} selected · ${photoCount} photo${photoCount === 1 ? '' : 's'}` : 'Select files to manage them together.'}</span></div>
    {count > 0 && <div className="selection-actions">{status === 'pending' ? <><button className="button primary" disabled={working} onClick={() => onReview('verify')}><Check size={16} />Confirm selected</button><button className="button reject" disabled={working} onClick={() => onReview('reject')}><X size={16} />Reject selected</button></> : <button className="button secondary" disabled={working} onClick={() => onReview('reset')}><RefreshCw size={16} />Restore selected</button>}{status === 'rejected' && <button className="button reject" disabled={working || Boolean(deleteBlocked)} onClick={onDelete}><Trash2 size={16} />Delete selected photos</button>}<button className="text-button" disabled={working} onClick={onClear}>Clear selection</button>{working && <span className="selection-progress"><LoaderCircle size={16} className="spin" />Saving changes…</span>}</div>}
    {count > 0 && deleteBlocked && <p className="selection-note">{deleteBlocked}</p>}
  </div>;
}

export function DeletePhotoDialog({ photos, detectionCount, onDelete, onClose }) {
  const dialog = useRef(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  async function submit() {
    if (working) return;
    setWorking(true); setError('');
    try { await onDelete(photos.map(photo => photo.image_id)); onClose(); }
    catch (failure) { setError(failure.message); setWorking(false); }
  }
  return <dialog ref={dialog} className="delete-photo-dialog" aria-labelledby="delete-photos-title" aria-describedby="delete-photos-description" onCancel={event => { event.preventDefault(); if (!working) onClose(); }} onClick={event => { if (!working && event.target === dialog.current) onClose(); }}>
    <h2 id="delete-photos-title">Delete rejected photos</h2><p id="delete-photos-description">Permanently delete {photos.length} photo{photos.length === 1 ? '' : 's'} and {detectionCount} rejected detection{detectionCount === 1 ? '' : 's'}? This cannot be undone. Source videos are kept.</p>
    <ul className="delete-photo-list">{photos.map(photo => <li key={photo.image_id}><span>{photo.filename}</span><small>{photo.image_id.slice(0, 8).toUpperCase()}</small></li>)}</ul>
    <p>Photos with pending or verified detections cannot be deleted.</p>
    {error && <div className="notice amber" role="alert">{error}</div>}
    <div className="delete-photo-actions"><button className="button secondary" disabled={working} onClick={onClose} autoFocus>Cancel</button><button className="button reject" disabled={working} onClick={submit}>{working ? <LoaderCircle size={16} className="spin" /> : <Trash2 size={16} />}Delete photos</button></div>
  </dialog>;
}
