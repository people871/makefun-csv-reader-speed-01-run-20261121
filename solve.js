// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answers, faster: most fields are plain text, so a field is taken as one
// slice up to its next comma or line break (found with indexOf, which scans in
// native code) instead of being built one character at a time. Whole records
// with no quote and no stray carriage return go through String.split(',').
// Quoted fields are scanned for their closing quote with indexOf as well.
// Only the rare broken pieces (stray CR, doubled quotes, embedded line
// breaks, junk after a closing quote, a quote that never closes) take the
// careful path, which follows the reference policy exactly.
//
// Policy (csv-reader 1.0.0): BOM dropped; a record ends at LF or CRLF; an
// empty line is no record; a CR outside quotes not followed by LF is dropped
// (stray_cr); a quoted field runs to the next non-doubled quote, "" inside is
// one quote, CRLF or a lone CR inside reads as LF, text after the closing
// quote up to the next comma or line break is appended as it stands
// (quote_junk); a quote that never closes is a literal character and the rest
// is re-read as unquoted (unterminated_quote); a quote inside an unquoted
// field is literal; fields stay strings; short rows are padded (short_row),
// long rows cut (long_row); errors carry {code, line, row} in the order met.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows
  // (null while it is the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters
  // the unquoted read kept (for the quote_junk test).
  let fieldValue = '';
  let fieldEnded = END;
  let fieldAdded = 0;

  function countLF(s) {
    let k = 0;
    let i = -1;
    while ((i = s.indexOf('\n', i + 1)) !== -1) k++;
    return k;
  }

  // Reads unquoted characters onto `value` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr).
  function readUnquoted(value) {
    let added = 0;
    while (pos < n) {
      const iC = text.indexOf(',', pos);
      if (iC === -1) {
        // No comma ahead: the field ends at the next LF, CRLF or the end.
        const iL = text.indexOf('\n', pos);
        if (iL === -1) {
          const seg = text.slice(pos, n);
          const r = seg.indexOf('\r');
          if (r === -1) {
            if (seg.length !== 0) { value += seg; added += seg.length; }
            pos = n;
            fieldValue = value; fieldEnded = END; fieldAdded = added;
            return;
          }
          if (r !== 0) { value += seg.slice(0, r); added += r; }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos = pos + r + 1;
          continue;
        }
        const seg = text.slice(pos, iL);
        const r = seg.indexOf('\r');
        if (r === -1) {
          if (seg.length !== 0) { value += seg; added += seg.length; }
          pos = iL + 1; line += 1;
          fieldValue = value; fieldEnded = LINE_BREAK; fieldAdded = added;
          return;
        }
        if (r === seg.length - 1) {
          if (r !== 0) { value += seg.slice(0, r); added += r; }
          pos = iL + 1; line += 1;
          fieldValue = value; fieldEnded = LINE_BREAK; fieldAdded = added;
          return;
        }
        if (r !== 0) { value += seg.slice(0, r); added += r; }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        pos = pos + r + 1;
        continue;
      }
      const seg = text.slice(pos, iC);
      const li = seg.indexOf('\n');
      if (li !== -1) {
        // A line break sits before the comma: the field ends there. A CR
        // just before it is the break's first half (CRLF); any earlier CR
        // is stray and is dropped with an error, then the scan repeats.
        let endPos = li;
        if (endPos > 0 && seg.charCodeAt(endPos - 1) === 13) endPos -= 1;
        const r = seg.indexOf('\r');
        if (r !== -1 && r < endPos) {
          if (r !== 0) { value += seg.slice(0, r); added += r; }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          pos = pos + r + 1;
          continue;
        }
        if (endPos !== 0) { value += seg.slice(0, endPos); added += endPos; }
        pos = pos + li + 1; line += 1;
        fieldValue = value; fieldEnded = LINE_BREAK; fieldAdded = added;
        return;
      }
      const r = seg.indexOf('\r');
      if (r === -1) {
        if (seg.length !== 0) { value += seg; added += seg.length; }
        pos = iC + 1;
        fieldValue = value; fieldEnded = COMMA; fieldAdded = added;
        return;
      }
      // No LF before the comma, so no CR here is followed by one: stray.
      if (r !== 0) { value += seg.slice(0, r); added += r; }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = pos + r + 1;
    }
    fieldValue = value;
    fieldEnded = END;
    fieldAdded = added;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let p = pos + 1;
    let chunkStart = p;
    // The field's pieces: the first piece kept bare in `value`, later ones
    // in `rest`, so the common one-piece field allocates no array.
    let value = '';
    let rest = null;
    while (true) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one literal quote inside the field.
        const chunk = text.slice(chunkStart, q);
        if (chunk !== '') {
          let s = chunk;
          if (chunk.indexOf('\r') !== -1) s = chunk.replace(/\r\n?/g, '\n');
          if (s.indexOf('\n') !== -1) line += countLF(s);
          if (rest === null) { if (value === '') value = s; else { rest = [value, s]; value = ''; } } else rest.push(s);
        }
        if (rest === null) { if (value === '') value = '"'; else { rest = [value, '"']; value = ''; } } else rest.push('"');
        p = q + 2;
        chunkStart = q + 2;
        continue;
      }
      // The closing quote.
      const chunk = text.slice(chunkStart, q);
      if (chunk !== '') {
        let s = chunk;
        if (chunk.indexOf('\r') !== -1) s = chunk.replace(/\r\n?/g, '\n');
        if (s.indexOf('\n') !== -1) line += countLF(s);
        if (rest === null) { if (value === '') value = s; else { rest = [value, s]; value = ''; } } else rest.push(s);
      }
      if (rest !== null) value = rest.join('');
      pos = q + 1;
      if (pos >= n) { fieldValue = value; fieldEnded = END; fieldAdded = 0; return; }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fieldValue = value; fieldEnded = COMMA; fieldAdded = 0;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fieldValue = value; fieldEnded = LINE_BREAK; fieldAdded = 0;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fieldValue = value; fieldEnded = LINE_BREAK; fieldAdded = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      readUnquoted(value);
      if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return;
    }
  }

  // Finishes a record: header, or a row padded/cut to the first record's width.
  function emitRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record whose first line holds no quote and no stray CR
    // is plain fields split on commas. The line is sliced once, so every
    // check below is bounded by the line's length.
    const lf = text.indexOf('\n', pos);
    const end = lf === -1 ? n : lf;
    const seg = text.slice(pos, end);
    if (seg.indexOf('"') === -1) {
      const r1 = seg.indexOf('\r');
      if (r1 === -1) {
        const fields = seg.split(',');
        if (lf === -1) pos = n;
        else { pos = lf + 1; line += 1; }
        if (fields.length === 1 && fields[0] === '') continue;
        emitRecord(fields);
        continue;
      }
      if (lf !== -1 && r1 === seg.length - 1 && seg.lastIndexOf('\r') === r1) {
        // CRLF only: the CR is the line break's first half.
        const fields = seg.split(',');
        fields[fields.length - 1] = fields[fields.length - 1].slice(0, -1);
        pos = lf + 1;
        line += 1;
        if (fields.length === 1 && fields[0] === '') continue;
        emitRecord(fields);
        continue;
      }
    }

    const fields = [];
    let wasQuoted = false;
    do {
      wasQuoted = text.charCodeAt(pos) === 34;
      if (wasQuoted) readQuoted();
      else readUnquoted('');
      fields.push(fieldValue);
    } while (fieldEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !wasQuoted) continue;
    emitRecord(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
