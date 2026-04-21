function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function fmtShortDate(iso) {
  const [y, m, d] = iso.split("-");
  return new Date(+y, +m - 1, +d).toLocaleString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

function fmtFullDate(iso) {
  const [y, m, d] = iso.split("-");
  return new Date(+y, +m - 1, +d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function makeFmtValue(range) {
  const step = range / 2;
  if (step >= 1_000_000) return v => "$" + (v / 1_000_000).toFixed(1) + "M";
  if (step >= 100_000)   return v => "$" + (v / 1_000_000).toFixed(2) + "M";
  if (step >= 10_000)    return v => "$" + (v / 1_000_000).toFixed(3) + "M";
  if (step >= 1_000)     return v => "$" + Math.round(v / 1_000) + "K";
  if (step >= 100)       return v => "$" + (v / 1_000).toFixed(1) + "K";
  return v => "$" + Math.round(v);
}

function fmtDollars(v) {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
  const fmtValue = makeFmtValue(range);
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

  // ── Hover layer ──────────────────────────────────────────────────────────────
  const hoverLine = svgEl("line", {
    x1: 0, y1: pad.top, x2: 0, y2: pad.top + chartH,
    stroke: "var(--color-text-dim)", "stroke-width": "1",
    "stroke-dasharray": "3 2",
    opacity: "0",
  });
  svg.appendChild(hoverLine);

  const hoverDot = svgEl("circle", {
    cx: 0, cy: 0, r: "4",
    fill: "var(--color-primary)",
    stroke: "var(--color-bg, #fff)", "stroke-width": "2",
    opacity: "0",
  });
  svg.appendChild(hoverDot);

  // Tooltip group
  const TIP_W = 110, TIP_H = 32, TIP_R = 4;
  const tipGroup = svgEl("g", { opacity: "0", "pointer-events": "none" });
  const tipRect = svgEl("rect", {
    width: TIP_W, height: TIP_H, rx: TIP_R, ry: TIP_R,
    fill: "var(--color-surface, #1e2227)",
    stroke: "var(--color-border)", "stroke-width": "1",
  });
  const tipDate = svgEl("text", {
    x: TIP_W / 2, y: 12,
    "text-anchor": "middle",
    fill: "var(--color-text-dim)",
    "font-size": "8",
    "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });
  const tipValue = svgEl("text", {
    x: TIP_W / 2, y: 24,
    "text-anchor": "middle",
    fill: "var(--color-text, #e8eaf0)",
    "font-size": "10",
    "font-weight": "600",
    "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });
  tipGroup.appendChild(tipRect);
  tipGroup.appendChild(tipDate);
  tipGroup.appendChild(tipValue);
  svg.appendChild(tipGroup);

  // Invisible hit area
  const hitArea = svgEl("rect", {
    x: pad.left, y: pad.top,
    width: chartW, height: chartH,
    fill: "transparent",
    cursor: "crosshair",
  });
  svg.appendChild(hitArea);

  function onMove(e) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const chartX = Math.max(0, Math.min(chartW, svgX - pad.left));

    // Snap to nearest point
    const rawIdx = (chartX / chartW) * (n - 1);
    const idx = Math.max(0, Math.min(n - 1, Math.round(rawIdx)));
    const pt = points[idx];
    const cx = xOf(idx);
    const cy = yOf(pt.value);

    hoverLine.setAttribute("x1", cx.toFixed(1));
    hoverLine.setAttribute("x2", cx.toFixed(1));
    hoverLine.setAttribute("opacity", "1");

    hoverDot.setAttribute("cx", cx.toFixed(1));
    hoverDot.setAttribute("cy", cy.toFixed(1));
    hoverDot.setAttribute("opacity", "1");

    tipDate.textContent = fmtFullDate(pt.date);
    tipValue.textContent = fmtDollars(pt.value);

    // Position tooltip: prefer above the dot, flip sides near edges
    let tx = cx - TIP_W / 2;
    if (tx < pad.left) tx = pad.left;
    if (tx + TIP_W > W - pad.right) tx = W - pad.right - TIP_W;
    const ty = cy - TIP_H - 8 < pad.top ? cy + 10 : cy - TIP_H - 8;

    tipGroup.setAttribute("transform", `translate(${tx.toFixed(1)},${ty.toFixed(1)})`);
    tipGroup.setAttribute("opacity", "1");
  }

  function onLeave() {
    hoverLine.setAttribute("opacity", "0");
    hoverDot.setAttribute("opacity", "0");
    tipGroup.setAttribute("opacity", "0");
  }

  hitArea.addEventListener("mousemove", onMove);
  hitArea.addEventListener("mouseleave", onLeave);

  return svg;
}
