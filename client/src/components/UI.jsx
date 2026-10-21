import { LoaderCircle } from 'lucide-react';

export function Button({ children, variant = 'primary', size, icon: Icon, loading = false, className = '', ...props }) {
  return (
    <button className={`button button-${variant}${size ? ` button-${size}` : ''}${className ? ` ${className}` : ''}`} disabled={loading || props.disabled} {...props}>
      {loading ? <LoaderCircle className="spin" size={17} /> : Icon ? <Icon size={17} strokeWidth={2} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageTitle({ eyebrow, title, description, actions }) {
  return (
    <div className="page-title-row">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }) {
  return <div className="state-panel" role="status"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>;
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-panel state-error" role="alert">
      <div><strong>Couldn’t load this view</strong><p>{message}</p></div>
      {onRetry && <button className="text-button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="empty-state">
      {Icon && <div className="empty-icon"><Icon size={22} /></div>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Field({ label, children, hint, className = '' }) {
  return <label className={`field${className ? ` ${className}` : ''}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Select({ value, onChange, children, ...props }) {
  return <select value={value} onChange={onChange} {...props}>{children}</select>;
}

export function Alert({ children, tone = 'error' }) {
  return <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function StatusBadge({ status }) {
  const tones = { Active: 'blue', Draft: 'neutral', Completed: 'green', Archived: 'neutral', Paid: 'green', Refunded: 'red', Cancelled: 'neutral', New: 'blue', Contacted: 'purple', Booked: 'blue', Attended: 'green', Purchased: 'green', Lost: 'red', 'No-show': 'orange', overdue: 'red', upcoming: 'blue' };
  return <Badge tone={tones[status] || 'neutral'}>{status}</Badge>;
}

export function TableWrap({ children }) {
  return <div className="table-scroll"><table className="data-table">{children}</table></div>;
}

export function useAsyncAction(action, onError) {
  return async (...args) => {
    try { return await action(...args); } catch (error) { onError?.(error.message); return undefined; }
  };
}
