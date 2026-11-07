// Minimal CSV parser: handles quoted fields (with embedded commas/newlines/escaped
// quotes) and CRLF/CR/LF line endings. Blank rows (all fields empty) are dropped.
export function parseCSV(text) {
  const rows = [];
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let row = [], field = "", inQuote = false, i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i += 2; }
      else if (ch === '"')                   { inQuote = false; i++; }
      else                                   { field += ch; i++; }
    } else {
      if      (ch === '"')  { inQuote = true; i++; }
      else if (ch === ',')  { row.push(field.trim()); field = ""; i++; }
      else if (ch === '\n') {
        row.push(field.trim()); field = "";
        if (row.some(c => c !== "")) rows.push(row);
        row = []; i++;
      } else { field += ch; i++; }
    }
  }
  row.push(field.trim());
  if (row.some(c => c !== "")) rows.push(row);
  return rows;
}

const AMOUNT_HEAD = /^[-(]?\s*\$?\s*-?\s*\d{1,3}(,\d{3})*$/;
const AMOUNT_TAIL = /^\d{3}(\.\d+)?\)?$/;

// Some bank exports (e.g. Citi) don't quote amounts of $1,000 or more, so the thousands
// separator splits "-$ 5,257.29" into two fields ("-$ 5", "257.29"). Rejoins those pieces
// in any row wider than the header row (rows[0]); rows of the right width are untouched.
export function repairSplitAmounts(rows) {
  if (rows.length === 0) return rows;
  const width = rows[0].length;
  return rows.map((row, r) => {
    if (r === 0 || row.length <= width) return row;
    const out = [...row];
    let i = 0;
    while (i < out.length - 1 && out.length > width) {
      if (AMOUNT_HEAD.test(out[i]) && AMOUNT_TAIL.test(out[i + 1])) {
        out.splice(i, 2, `${out[i]},${out[i + 1]}`);
      } else {
        i++;
      }
    }
    return out;
  });
}
