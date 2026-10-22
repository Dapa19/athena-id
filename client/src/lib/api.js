export async function api(path, options = {}) {
  const { json, headers: customHeaders, ...rest } = options;
  const headers = new Headers(customHeaders || {});
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...rest,
    headers,
    body: json === undefined ? rest.body : JSON.stringify(json)
  });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'The request could not be completed.');
    error.status = response.status;
    error.code = data?.error?.code;
    throw error;
  }
  return data;
}

export const formatIDR = (amount, compact = false) => {
  if (amount == null || Number.isNaN(Number(amount))) return '—';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard'
  }).format(Number(amount));
};

export const formatDate = (value, options = {}) => {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+07:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta', ...options }).format(date);
};

export const todayString = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

function parseCsvText(text) {
  if (!text) return [];
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell !== '')) rows.push(row);
  }
  return rows;
}

function excelCell(type, value) {
  const safe = String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  return `<Cell><Data ss:Type="${type}">${safe}</Data></Cell>`;
}

export function downloadCsvText(text, filename = 'export.csv') {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadExcelFromText(text, filename = 'export.xls') {
  const rows = parseCsvText(text);
  const worksheet = rows.map((row) => `<Row>${row.map((cell) => excelCell('String', cell)).join('')}</Row>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
      <Worksheet ss:Name="Sheet1"><Table>${worksheet}</Table></Worksheet>
    </Workbook>`;
  const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.xls') ? filename : `${filename}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(url, filename = 'export.csv') {
  return fetch(url, { credentials: 'same-origin' })
    .then((response) => response.text())
    .then((text) => downloadCsvText(text, filename))
    .catch(() => window.location.assign(url));
}

export function downloadExcel(url, filename = 'export.xls') {
  return fetch(url, { credentials: 'same-origin' })
    .then((response) => response.text())
    .then((text) => downloadExcelFromText(text, filename))
    .catch(() => window.location.assign(url));
}

export function withQuery(path, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values || {})) if (value !== '' && value != null) params.set(key, String(value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
