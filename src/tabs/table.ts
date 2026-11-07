/** CSV/TSV as NFTab writes it: a header row, RFC 4180 quoting, the empty field is null. */

export function parseDelimited(text: string, delimiter: ',' | '\t'): { header: string[]; rows: (string | null)[][] } {
  const records: (string | null)[][] = [];
  let field = '';
  let record: (string | null)[] = [];
  let quoted = false;
  let wasQuoted = false;
  const end = () => { record.push(field === '' && !wasQuoted ? null : field); field = ''; wasQuoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') { quoted = true; wasQuoted = true; }
    else if (c === delimiter) end();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      end();
      if (record.some((v) => v !== null) || record.length > 1) records.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length) { end(); records.push(record); }
  const [header = [], ...rows] = records;
  return { header: header.map((h) => String(h ?? '').trim()), rows };
}

export type Dtype = 'string' | 'int32' | 'int64' | 'float32' | 'float64' | 'bool' | 'date' | 'datetime' | 'json';

/** One cell as its declared dtype; null stays null. */
export function convert(v: string | null, dtype: Dtype, where: string): unknown {
  if (v === null) return null;
  switch (dtype) {
    case 'int32': case 'int64': case 'float32': case 'float64': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${where}: "${v}" is not a number`);
      return n;
    }
    case 'bool': {
      const s = v.toLowerCase();
      if (s === 'true' || s === '1') return true;
      if (s === 'false' || s === '0') return false;
      throw new Error(`${where}: "${v}" is not a boolean`);
    }
    case 'json':
      try { return JSON.parse(v); } catch { throw new Error(`${where}: not valid JSON`); }
    default:
      return v;
  }
}
