import { useEffect } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, description, onClose, children, size = 'medium' }) {
  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p className="muted">{description}</p>}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button>
        </header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}
