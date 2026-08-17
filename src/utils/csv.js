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
