import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { Alert, Button, EmptyState, Field, Select, StatusBadge, TableWrap } from '../components/UI.jsx';

const fieldLabels = {
  displayName: 'Name or reference', phone: 'Contact number', source: 'Source', campaign: 'Campaign', branch: 'Branch',
  assignee: 'Assigned staff', status: 'Status', createdDate: 'Created date', nextFollowUpDate: 'Next follow-up', notes: 'Operational note',
  leadReference: 'Lead reference', transactionDate: 'Transaction date', amountIdr: 'Amount (IDR)', reference: 'Receipt / reference'
};
const requiredFields = { leads: ['displayName'], transactions: ['branch', 'transactionDate', 'amountIdr', 'status'] };
const descriptions = {
  leads: 'Upload lead records with contact and attribution details.',
  transactions: 'Upload transaction records with amount, branch, date, and outcome.'
};

export function ImportPage({ type: initialType = 'leads', navigate, notify }) {
  const [type, setType] = useState(initialType === 'transactions' ? 'transactions' : 'leads');
  const [fileName, setFileName] = useState('');
  const [mimeType, setMimeType] = useState('');
  const [csvText, setCsvText] = useState('');
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [allowDuplicates, setAllowDuplicates] = useState(false);

  const fields = type === 'leads'
    ? ['displayName', 'phone', 'source', 'campaign', 'branch', 'assignee', 'status', 'createdDate', 'nextFollowUpDate', 'notes']
    : ['leadReference', 'branch', 'campaign', 'transactionDate', 'amountIdr', 'status', 'reference'];

  async function readFile(file) {
    setError(''); setPreview(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Choose a .csv file.'); return; }
    if (file.size > 1024 * 1024) { setError('CSV files must be smaller than 1 MB.'); return; }
    setLoading(true);
    try {
      if (file.type && !['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.type.toLowerCase().split(';')[0].trim())) {
        throw new Error('Choose a CSV file, not an executable or spreadsheet workbook.');
      }
      const text = await file.text();
      setCsvText(text); setFileName(file.name); setMimeType(file.type);
      const result = await api('/api/imports/preview', { method: 'POST', json: { type, csvText: text, fileName: file.name, mimeType: file.type } });
      setHeaders(result.headers); setMapping(result.mapping); setPreview(result); setAllowDuplicates(false); setStep(2);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  async function validateMapping(event) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await api('/api/imports/preview', { method: 'POST', json: { type, csvText, fileName, mimeType, mapping } });
      setPreview(result); setAllowDuplicates(false); setStep(3);
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  async function commitImport() {
    if (!preview) return;
    const rows = preview.rows.filter((row) => row.errors.length === 0);
    if (!rows.length) return;
    setLoading(true); setError('');
    try {
      const result = await api('/api/imports/commit', { method: 'POST', json: { type, rows, allowDuplicates } });
      notify(`${result.imported} ${type} imported`);
      navigate(type === 'leads' ? 'leads' : 'transactions');
    } catch (requestError) { setError(requestError.message); }
    finally { setLoading(false); }
  }

  function restart() {
    setFileName(''); setMimeType(''); setCsvText(''); setHeaders([]); setMapping({}); setPreview(null); setStep(1); setError(''); setAllowDuplicates(false);
  }

  return <div className="page-content import-page">
    <button className="back-link" onClick={() => navigate(type === 'leads' ? 'leads' : 'transactions')}><ArrowLeft size={16} /> {type === 'leads' ? 'Leads' : 'Transactions'}</button>
    <div className="import-heading"><div><div className="eyebrow">Data import</div><h1>Import {type}</h1><p className="page-description">{descriptions[type]}</p></div><label className="import-type-select"><span>Import type</span><Select value={type} onChange={(event) => { setType(event.target.value); restart(); }}><option value="leads">Leads</option><option value="transactions">Transactions</option></Select></label></div>
    <div className="import-steps"><div className={step >= 1 ? 'active' : ''}><span>1</span>Upload file</div><i /><div className={step >= 2 ? 'active' : ''}><span>2</span>Map columns</div><i /><div className={step >= 3 ? 'active' : ''}><span>3</span>Review & import</div></div>
    {error && <Alert>{error}</Alert>}

    {step === 1 && <section className="import-dropzone panel">
      <div className="upload-icon"><Upload size={23} /></div><h2>Choose a CSV file</h2><p>Maximum 1 MB and 2,000 rows. The file is read for validation and is not stored.</p>
      <label className="button button-primary upload-button"><FileSpreadsheet size={17} /><span>{loading ? 'Reading file…' : 'Choose CSV'}</span><input type="file" accept=".csv,text/csv" onChange={(event) => readFile(event.target.files?.[0])} disabled={loading} /></label>
      <div className="field-hint">Use UTF-8 CSV with one header row. Whole IDR amounts only.</div>
    </section>}

    {step === 2 && <section className="panel import-map-panel">
      <div className="panel-heading"><div><h2>Match your columns</h2><p>{fileName} · {headers.length} columns detected</p></div><button className="text-button" onClick={restart}>Choose another file</button></div>
      <form className="mapping-grid" onSubmit={validateMapping}>
        {fields.map((field) => <Field key={field} label={<>{fieldLabels[field]}{requiredFields[type].includes(field) && <span className="required-mark"> · required</span>}</>}>
          <Select value={mapping[field] || ''} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}>
            <option value="">{field === 'status' && type === 'leads' ? 'Default: New' : field === 'source' ? 'Default: CSV import' : 'Not mapped'}</option>
            {headers.map((header) => <option key={header} value={header}>{header}</option>)}
          </Select>
        </Field>)}
        <div className="mapping-actions"><div className="field-hint">Optional columns can be left unmapped. Check the preview before importing.</div><Button type="submit" loading={loading} icon={ArrowRight}>Validate preview</Button></div>
      </form>
    </section>}

    {step === 3 && preview && <section className="import-review panel">
      <div className="panel-heading"><div><h2>Review rows</h2><p>{fileName} · {preview.rows.length} rows checked</p></div><Button variant="secondary" icon={RefreshCw} onClick={() => setStep(2)}>Edit column mapping</Button></div>
      <div className="review-summary"><div><strong>{preview.validCount}</strong><span>valid rows</span></div><div className={preview.errorCount ? 'review-error' : ''}><strong>{preview.errorCount}</strong><span>rows with errors</span></div><div className={preview.duplicateCount ? 'review-warning' : ''}><strong>{preview.duplicateCount}</strong><span>possible duplicates</span></div></div>
      {preview.errorCount > 0 && <div className="alert alert-warning">Rows with errors will be skipped. Review the messages below, adjust the mapping, or correct the source file.</div>}
      {preview.duplicateCount > 0 && <label className="duplicate-confirm"><input type="checkbox" checked={allowDuplicates} onChange={(event) => setAllowDuplicates(event.target.checked)} /><span>I reviewed the possible duplicates and want to import them anyway.</span></label>}
      <div className="review-table-wrap"><TableWrap><thead><tr><th>Row</th><th>Record</th><th>Attribution</th><th>Result</th></tr></thead><tbody>
        {preview.rows.map((row) => <tr key={row.rowNumber} className={row.errors.length ? 'row-error' : row.warnings.length ? 'row-warning' : ''}>
          <td>{row.rowNumber}</td>
          <td>{type === 'leads' ? <><strong>{row.values.displayName || '—'}</strong><span className="table-subtext">{row.values.phone || 'No contact number'}</span></> : <><strong>{row.values.leadId ? `Lead #${row.values.leadId}` : 'Unlinked transaction'}</strong><span className="table-subtext">{row.values.transactionDate || '—'} · {row.values.amountIdr ?? '—'} IDR</span></>}</td>
          <td>{type === 'leads' ? <>{row.values.campaignId ? `Campaign #${row.values.campaignId}` : 'No campaign'} · {row.values.branchId ? `Branch #${row.values.branchId}` : 'No branch'}</> : <>{row.values.campaignId ? `Campaign #${row.values.campaignId}` : 'No campaign'} · Branch #{row.values.branchId || '—'}</>}</td>
          <td>{row.errors.length ? <span className="review-messages">{row.errors.map((message) => <span key={message}>{message}</span>)}</span> : row.warnings.length ? <span className="review-messages warning-messages">{row.warnings.map((message) => <span key={message}>{message}</span>)}</span> : <StatusBadge status="Completed" />}</td>
        </tr>)}
      </tbody></TableWrap></div>
      <div className="review-footer"><button className="text-button" onClick={restart}>Cancel import</button><div><span className="review-footnote">{preview.errorCount ? 'Only valid rows will be imported.' : 'No records are created until you confirm.'}</span><Button icon={Check} loading={loading} disabled={preview.validCount === 0 || (preview.duplicateCount > 0 && !allowDuplicates)} onClick={commitImport}>Import {preview.validCount} rows</Button></div></div>
    </section>}
  </div>;
}
