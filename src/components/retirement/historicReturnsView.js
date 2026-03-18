import { COLUMNS, HISTORIC_DATA as DATA } from "./historicData.js";

// ── Statistics helpers ─────────────────────────────────────────────────────────

function arithmeticMean(values) {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function geometricMean(values) {
  // CAGR: ((1+r1)(1+r2)...(1+rn))^(1/n) - 1
  const product = values.reduce((p, v) => p * (1 + v / 100), 1);
  return (Math.pow(product, 1 / values.length) - 1) * 100;
}

function stdDev(values) {
  const mean = arithmeticMean(values);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeStats(key) {
  const vals = DATA.map((d) => d[key]);
  const best  = Math.max(...vals);
  const worst = Math.min(...vals);
  const bestYear  = DATA.find((d) => d[key] === best)?.year;
  const worstYear = DATA.find((d) => d[key] === worst)?.year;
  return {
    arithAvg: arithmeticMean(vals),
    cagr:     geometricMean(vals),
    stdDev:   stdDev(vals),
    best, bestYear,
    worst, worstYear,
  };
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function fmtPct(v, digits = 2) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function pctCell(v, digits = 2) {
  const cls = v > 0 ? "hist-pos" : v < 0 ? "hist-neg" : "hist-neutral";
  return `<td class="${cls}">${fmtPct(v, digits)}</td>`;
}

function pctCellEl(v, digits = 2) {
  const td = document.createElement("td");
  td.className = v > 0 ? "hist-pos" : v < 0 ? "hist-neg" : "hist-neutral";
  td.textContent = fmtPct(v, digits);
  return td;
}

// ── Render ─────────────────────────────────────────────────────────────────────

export function renderHistoricReturnsView(container) {
  container.innerHTML = "";

  const page = document.createElement("div");
  page.className = "hist-page";

  // ── Header ──────────────────────────────────────────────────────────────────
  const hdr = document.createElement("div");
  hdr.className = "hist-header";
  hdr.innerHTML = `
    <h2 class="hist-title">Historic Annual Returns</h2>
    <p class="hist-subtitle">Annual total returns by asset class, 1928–2025. Source: Damodaran Online (NYU Stern).
      ★ Gold uses London PM fix price. Real Estate uses NAREIT equity REIT index.
      2025 values are preliminary estimates.</p>
  `;
  page.appendChild(hdr);

  // ── Summary statistics card ──────────────────────────────────────────────────
  const statsCard = document.createElement("div");
  statsCard.className = "hist-stats-card card";

  const statsTitle = document.createElement("div");
  statsTitle.className = "hist-stats-title";
  statsTitle.textContent = "Summary Statistics (1928–2025)";
  statsCard.appendChild(statsTitle);

  const statsWrap = document.createElement("div");
  statsWrap.className = "hist-stats-wrap";

  const statsTable = document.createElement("table");
  statsTable.className = "hist-stats-table";

  // Header row
  const thead = statsTable.createTHead();
  const thRow = thead.insertRow();
  const thStat = document.createElement("th");
  thStat.textContent = "Statistic";
  thRow.appendChild(thStat);
  COLUMNS.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    if (col.sub) {
      const sub = document.createElement("div");
      sub.className = "hist-col-sub";
      sub.textContent = col.sub;
      th.appendChild(sub);
    }
    thRow.appendChild(th);
  });

  // Compute stats for all columns
  const stats = {};
  COLUMNS.forEach((col) => { stats[col.key] = computeStats(col.key); });

  const STAT_ROWS = [
    { label: "Arith. Avg",  fn: (s) => s.arithAvg },
    { label: "CAGR",        fn: (s) => s.cagr },
    { label: "Std Dev",     fn: (s) => s.stdDev, neutralColor: true },
    { label: "Best Year",   fn: (s) => s.best,  suffix: (s) => ` (${s.bestYear})` },
    { label: "Worst Year",  fn: (s) => s.worst, suffix: (s) => ` (${s.worstYear})` },
  ];

  const tbody = statsTable.createTBody();
  STAT_ROWS.forEach(({ label, fn, suffix, neutralColor }) => {
    const tr = tbody.insertRow();
    const tdLabel = document.createElement("td");
    tdLabel.className = "hist-stat-label";
    tdLabel.textContent = label;
    tr.appendChild(tdLabel);

    COLUMNS.forEach((col) => {
      const s = stats[col.key];
      const v = fn(s);
      const td = document.createElement("td");
      if (!neutralColor) {
        td.className = v > 0 ? "hist-pos" : v < 0 ? "hist-neg" : "hist-neutral";
      }
      td.textContent = fmtPct(v, 2) + (suffix ? suffix(s) : "");
      tr.appendChild(td);
    });
  });

  statsWrap.appendChild(statsTable);
  statsCard.appendChild(statsWrap);
  page.appendChild(statsCard);

  // ── Year-by-year table ────────────────────────────────────────────────────────
  const tableCard = document.createElement("div");
  tableCard.className = "hist-table-card card";

  const tableTitle = document.createElement("div");
  tableTitle.className = "hist-stats-title";
  tableTitle.textContent = "Year-by-Year Returns";
  tableCard.appendChild(tableTitle);

  const tableWrap = document.createElement("div");
  tableWrap.className = "hist-table-wrap";

  const table = document.createElement("table");
  table.className = "hist-table";

  // Table header
  const tHead = table.createTHead();
  const hRow = tHead.insertRow();
  const yearTh = document.createElement("th");
  yearTh.textContent = "Year";
  yearTh.className = "hist-year-col";
  hRow.appendChild(yearTh);

  COLUMNS.forEach((col) => {
    const th = document.createElement("th");
    th.innerHTML = col.sub
      ? `${col.label}<div class="hist-col-sub">${col.sub}</div>`
      : col.label;
    hRow.appendChild(th);
  });

  // Table body
  const tBody = table.createTBody();
  DATA.forEach((row) => {
    const tr = tBody.insertRow();

    // Year cell
    const yearTd = document.createElement("td");
    yearTd.className = "hist-year-cell";
    yearTd.textContent = row.year;
    if (row.year === 2025) {
      yearTd.title = "Preliminary estimate";
      yearTd.innerHTML = `${row.year}<sup class="hist-est">est</sup>`;
    }
    tr.appendChild(yearTd);

    // Data cells
    COLUMNS.forEach((col) => {
      tr.appendChild(pctCellEl(row[col.key]));
    });
  });

  tableWrap.appendChild(table);
  tableCard.appendChild(tableWrap);
  page.appendChild(tableCard);

  container.appendChild(page);
}
