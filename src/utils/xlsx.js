// Minimal, dependency-free .xlsx reader: returns the first worksheet as an array of rows,
// each an array of trimmed cell strings (same shape as parseCSV in csv.js). Blank rows
// are dropped. Handles shared strings, inline strings, numbers and booleans — enough for
// broker exports (e.g. Morgan Stanley holdings). Formulas are read as their cached values.
//
// An .xlsx file is a ZIP of XML parts; entries are inflated with the browser's native
// DecompressionStream("deflate-raw"), and the XML is read with DOMParser.

const SIG_EOCD = 0x06054b50;
const SIG_CDIR = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function readZipEntries(buf) {
  const view = new DataView(buf);
  let eocd = -1;
  // The end-of-central-directory record sits in the last 22 bytes + up to 64 KB of comment.
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("Not a valid .xlsx file.");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== SIG_CDIR) throw new Error("Corrupt .xlsx file.");
    const method   = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen  = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commLen  = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(buf, p + 46, nameLen));
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + commLen;
  }

  async function read(name) {
    const e = entries.get(name);
    if (!e) return null;
    if (view.getUint32(e.localOff, true) !== SIG_LOCAL) throw new Error("Corrupt .xlsx file.");
    const start = e.localOff + 30 + view.getUint16(e.localOff + 26, true) + view.getUint16(e.localOff + 28, true);
    const data = new Uint8Array(buf, start, e.compSize);
    if (e.method === 0) return decoder.decode(data);
    if (e.method !== 8) throw new Error("Unsupported compression in .xlsx file.");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Response(stream).text();
  }

  return { read };
}

function parseXml(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

// Elements by local name, ignoring namespace prefixes (transitional and strict OOXML differ).
function els(node, localName) {
  return Array.from(node.getElementsByTagNameNS("*", localName));
}

// Text of an <si>/<is> string item: all <t> runs, skipping phonetic (<rPh>) hints.
function stringItemText(node) {
  return els(node, "t")
    .filter((t) => t.parentNode.localName !== "rPh")
    .map((t) => t.textContent)
    .join("");
}

function colIndex(ref) {
  const letters = /^[A-Z]+/i.exec(ref || "");
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Path of the first worksheet, via workbook.xml + its relationships; falls back to sheet1.
async function firstSheetPath(zip) {
  const fallback = "xl/worksheets/sheet1.xml";
  const wbText = await zip.read("xl/workbook.xml");
  const relsText = await zip.read("xl/_rels/workbook.xml.rels");
  if (!wbText || !relsText) return fallback;
  const sheet = els(parseXml(wbText), "sheet")[0];
  if (!sheet) return fallback;
  const rid = sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
    || sheet.getAttribute("r:id");
  const rel = els(parseXml(relsText), "Relationship").find((r) => r.getAttribute("Id") === rid);
  const target = rel && rel.getAttribute("Target");
  if (!target) return fallback;
  return target.startsWith("/") ? target.slice(1) : `xl/${target}`;
}

export async function readXlsxRows(arrayBuffer) {
  const zip = readZipEntries(arrayBuffer);

  const ssText = await zip.read("xl/sharedStrings.xml");
  const shared = ssText ? els(parseXml(ssText), "si").map(stringItemText) : [];

  const sheetText = await zip.read(await firstSheetPath(zip));
  if (!sheetText) throw new Error("No worksheet found in .xlsx file.");

  const rows = [];
  for (const rowEl of els(parseXml(sheetText), "row")) {
    const row = [];
    let next = 0;
    for (const c of Array.from(rowEl.children).filter((n) => n.localName === "c")) {
      const idx = colIndex(c.getAttribute("r"));
      const col = idx >= 0 ? idx : next;
      next = col + 1;

      const type = c.getAttribute("t");
      const v = Array.from(c.children).find((n) => n.localName === "v");
      let val = "";
      if (type === "inlineStr") {
        const is = Array.from(c.children).find((n) => n.localName === "is");
        val = is ? stringItemText(is) : "";
      } else if (v) {
        const raw = v.textContent;
        if (type === "s")      val = shared[parseInt(raw, 10)] ?? "";
        else if (type === "b") val = raw === "1" ? "TRUE" : "FALSE";
        else if (type === "str" || type === "e") val = raw;
        else {
          // Numbers: normalize float noise like 201.49000000000001 → 201.49
          const num = Number(raw);
          val = Number.isFinite(num) ? String(Number(num.toPrecision(15))) : raw;
        }
      }
      while (row.length < col) row.push("");
      row[col] = val.trim();
    }
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}
