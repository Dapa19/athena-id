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

export function downloadCsv(url) {
  window.location.assign(url);
}

export function withQuery(path, values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values || {})) if (value !== '' && value != null) params.set(key, String(value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
