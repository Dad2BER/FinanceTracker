function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function fmtShortDate(iso) {
  const [y, m] = iso.split("-");
  return new Date(+y, +m - 1, 1).toLocaleString("en-US", { month: "short", year: "2-digit" });
}

function fmtValue(v) {
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return "$" + Math.round(v / 1_000) + "K";
  return "$" + Math.round(v);
}

/**
 * Creates an SVG line chart showing net worth over time.
 * @param {Array<{date: string, value: number}>} points - sorted ascending by date
 */
export function createNetWorthChart(points) {
  const W = 480, H = 130;
  const pad = { top: 14, right: 14, bottom: 26, left: 52 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "nw-chart-svg" });

  if (points.length < 2) {
    const t = svgEl("text", {
      x: W / 2, y: H / 2,
      "text-anchor": "middle",
      fill: "var(--color-text-dim)",
      "font-size": "11",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    t.textContent = "Not enough history yet — check back after prices load a few days";
    svg.appendChild(t);
    return svg;
  }

  const vals = points.map(p => p.value);
  const minVal = Math.min(...vals);
  const maxVal = Math.max(...vals);
  const range = maxVal - minVal || 1;
  const n = points.length;

  const xOf = i => pad.left + (i / (n - 1)) * chartW;
  const yOf = v => pad.top + chartH - ((v - minVal) / range) * chartH;

  // Horizontal grid lines + y-axis labels (3 levels)
  for (let i = 0; i <= 2; i++) {
    const v = minVal + (range * i) / 2;
    const y = yOf(v);
    svg.appendChild(svgEl("line", {
      x1: pad.left, y1: y, x2: pad.left + chartW, y2: y,
      stroke: "var(--color-border)", "stroke-width": "1",
    }));
    const lbl = svgEl("text", {
      x: pad.left - 5, y: y + 4,
      "text-anchor": "end",
      fill: "var(--color-text-dim)",
      "font-size": "8.5",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    lbl.textContent = fmtValue(v);
    svg.appendChild(lbl);
  }

  // Area fill under the line
  const areaD = `M ${xOf(0).toFixed(1)},${(pad.top + chartH).toFixed(1)} ` +
    points.map((p, i) => `L ${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ") +
    ` L ${xOf(n - 1).toFixed(1)},${(pad.top + chartH).toFixed(1)} Z`;
  svg.appendChild(svgEl("path", {
    d: areaD,
    fill: "var(--color-primary)",
    opacity: "0.12",
  }));

  // Line
  const lineD = points.map((p, i) =>
    `${i === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`
  ).join(" ");
  svg.appendChild(svgEl("path", {
    d: lineD,
    fill: "none",
    stroke: "var(--color-primary)",
    "stroke-width": "1.75",
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
  }));

  // End dot
  svg.appendChild(svgEl("circle", {
    cx: xOf(n - 1).toFixed(1),
    cy: yOf(points[n - 1].value).toFixed(1),
    r: "3",
    fill: "var(--color-primary)",
  }));

  // X-axis date labels (first, middle, last)
  const labelIdxs = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1];
  labelIdxs.forEach(i => {
    const lbl = svgEl("text", {
      x: xOf(i).toFixed(1),
      y: H - 4,
      "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle",
      fill: "var(--color-text-dim)",
      "font-size": "8.5",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    lbl.textContent = fmtShortDate(points[i].date);
    svg.appendChild(lbl);
  });

  return svg;
}
