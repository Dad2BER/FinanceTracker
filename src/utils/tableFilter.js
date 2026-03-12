/**
 * Attaches per-column live filter inputs to a table.
 *
 * @param {HTMLTableElement} table
 * @param {boolean[]} filterable
 *   One entry per column.  true = render a filter input, false = empty cell.
 *   Must match the number of <th> cells in the header row.
 */
export function attachTableFilter(table, filterable) {
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  // ── Filter input row ────────────────────────────────────────────────────────
  const filterRow = document.createElement("tr");
  filterRow.className = "filter-row";

  filterable.forEach((active) => {
    const th = document.createElement("th");
    if (active) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "filter-input";
      input.placeholder = "Filter…";
      th.appendChild(input);
    }
    filterRow.appendChild(th);
  });

  thead.appendChild(filterRow);

  // ── Live filtering ──────────────────────────────────────────────────────────
  function applyFilters() {
    const filters = [...filterRow.querySelectorAll("th")].map((th) => {
      const inp = th.querySelector("input");
      return inp ? inp.value.trim().toLowerCase() : "";
    });

    const anyActive = filters.some((f) => f !== "");

    for (const row of tbody.querySelectorAll("tr")) {
      if (!anyActive) {
        row.style.display = "";
        continue;
      }
      const cells = row.querySelectorAll("td");
      const visible = filters.every((filter, i) => {
        if (!filter) return true;
        return (cells[i]?.textContent ?? "").toLowerCase().includes(filter);
      });
      row.style.display = visible ? "" : "none";
    }
  }

  filterRow.addEventListener("input", applyFilters);
}
