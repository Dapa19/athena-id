export function parseCsv(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) {
    throw Object.assign(new Error('CSV file must be smaller than 1 MB.'), { status: 400, code: 'CSV_TOO_LARGE' });
  }
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw Object.assign(new Error('This file is not a valid CSV.'), { status: 400, code: 'INVALID_CSV' });
  if (/^(?:MZ|PK\x03\x04|\x7fELF|\xca\xfe\xba\xbe|\xfe\xed\xfa|#!\s*\/)/.test(text)) {
    throw Object.assign(new Error('Executable or binary files are not accepted.'), { status: 400, code: 'INVALID_FILE_TYPE' });
  }

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell) throw Object.assign(new Error('Unexpected quote in CSV data.'), { status: 400, code: 'INVALID_CSV' });
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
    if (rows.length > 2001) throw Object.assign(new Error('CSV files can contain at most 2,000 data rows.'), { status: 400, code: 'CSV_TOO_MANY_ROWS' });
  }
  if (quoted) throw Object.assign(new Error('A quoted CSV value is not closed.'), { status: 400, code: 'INVALID_CSV' });
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length < 2) throw Object.assign(new Error('Add a header row and at least one data row.'), { status: 400, code: 'CSV_EMPTY' });

  const headers = rows.shift().map((header) => header.trim());
  if (headers.length > 40 || headers.some((header) => !header) || new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw Object.assign(new Error('CSV headers must be unique, non-empty, and limited to 40 columns.'), { status: 400, code: 'CSV_HEADERS' });
  }
  return {
    headers,
    rows: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])))
  };
}

export function stringifyCsv(records, columns) {
  const quote = (value) => {
    let string = value == null ? '' : String(value);
    if (/^\s*[=+\-@]/.test(string)) string = `'${string}`;
    return /[",\r\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
  };
  return [columns.map((column) => quote(column.label)).join(','), ...records.map((record) => columns.map((column) => quote(record[column.key])).join(','))].join('\r\n');
}
