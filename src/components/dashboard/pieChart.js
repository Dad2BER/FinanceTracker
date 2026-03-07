function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(cx, cy, outerR, innerR, startDeg, endDeg) {
  const o1 = polarToCartesian(cx, cy, outerR, startDeg);
  const o2 = polarToCartesian(cx, cy, outerR, endDeg);
  const i1 = polarToCartesian(cx, cy, innerR, endDeg);
  const i2 = polarToCartesian(cx, cy, innerR, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${o1.x} ${o1.y} A ${outerR} ${outerR} 0 ${large} 1 ${o2.x} ${o2.y} L ${i1.x} ${i1.y} A ${innerR} ${innerR} 0 ${large} 0 ${i2.x} ${i2.y} Z`;
}

function formatCompact(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Creates an SVG donut chart.
 * @param {Array<{label, value, color}>} slices
 * @param {number} total - portfolio total to display in center
 */
export function createPieChart(slices, total) {
  const cx = 100, cy = 100, outerR = 86, innerR = 54;
  const svg = svgEl("svg", { viewBox: "0 0 200 200", class: "pie-svg" });

  const active = slices.filter((s) => s.value > 0);

  if (active.length === 0) {
    // Empty ring
    svg.appendChild(svgEl("circle", {
      cx, cy, r: (outerR + innerR) / 2,
      fill: "none",
      stroke: "var(--color-border)",
      "stroke-width": outerR - innerR,
    }));
  } else if (active.length === 1) {
    // Full ring — SVG can't arc 360°, so draw two halves
    [0, 180].forEach((start) => {
      const p = svgEl("path", {
        d: slicePath(cx, cy, outerR, innerR, start, start + 180),
        fill: active[0].color,
      });
      svg.appendChild(p);
    });
  } else {
    let startDeg = 0;
    for (const slice of active) {
      const deg = (slice.value / total) * 360;
      svg.appendChild(svgEl("path", {
        d: slicePath(cx, cy, outerR, innerR, startDeg, startDeg + deg),
        fill: slice.color,
      }));
      startDeg += deg;
    }
  }

  // Center label
  if (total > 0) {
    const label = svgEl("text", {
      x: cx, y: cy - 8,
      "text-anchor": "middle",
      fill: "var(--color-text-dim)",
      "font-size": "10",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });
    label.textContent = "TOTAL";
    svg.appendChild(label);

    const amount = svgEl("text", {
      x: cx, y: cy + 10,
      "text-anchor": "middle",
      fill: "var(--color-text)",
      "font-size": "14",
      "font-weight": "700",
      "font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    });
    amount.textContent = formatCompact(total);
    svg.appendChild(amount);
  }

  return svg;
}
