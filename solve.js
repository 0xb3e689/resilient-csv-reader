/** Read CSV using the csv-reader 1.0.0 rules for malformed fields and rows. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const length = text.length;
  const rows = [];
  const errors = [];
  let columns = null;
  let width = 0;
  let line = 1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  while (pos < length) {
    const recordLine = line;
    const row = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    let end;

    do {
      let start = pos;
      let value = '';
      quoted = text.charCodeAt(pos) === 34;
      let closed = false;
      if (quoted) {
        let quote = text.indexOf('"', pos + 1);
        while (quote !== -1 && text.charCodeAt(quote + 1) === 34) {
          quote = text.indexOf('"', quote + 2);
        }

        if (quote === -1) {
          errors.push({ code: 'unterminated_quote', line: recordLine, row });
        } else {
          value = text.slice(pos + 1, quote).replace(/""|\r\n?|\n/g, (match) => {
            if (match === '""') return '"';
            line++;
            return '\n';
          });
          start = pos = quote + 1;
          closed = true;
        }
      }

      let junk = false;
      while (pos < length) {
        const c = text.charCodeAt(pos);
        if (c === 44 || c === 10 || (c === 13 && text.charCodeAt(pos + 1) === 10)) break;
        if (c === 13) {
          errors.push({ code: 'stray_cr', line: recordLine, row });
          if (pos > start) {
            value += text.slice(start, pos);
            junk = true;
          }
          start = pos + 1;
        }
        pos++;
      }
      if (pos > start) {
        value += text.slice(start, pos);
        junk = true;
      }
      if (closed && junk) errors.push({ code: 'quote_junk', line: recordLine, row });
      fields.push(value);

      end = text.charCodeAt(pos);
      if (end === 44) pos++;
      else if (pos < length) {
        pos += end === 13 ? 2 : 1;
        line++;
      }
    } while (end === 44);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    if (width === 0) width = fields.length;
    if (row === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? columns ?? [] : null, rows, errors };
}
