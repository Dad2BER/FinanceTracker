/**
 * Attaches per-column live filter inputs to a table.
 *
 * @param {HTMLTableElement} table
 * @param {Array} descriptors
 *   One entry per column. Supported values:
 *     true / 'text'              → plain text filter input
 *     'daterange'                → two date pickers (from / to)
 *     { type:'select', options } → dropdown of provided string options
 *     false / null / undefined   → no filter cell
 *
 * Backward-compatible: passing `true` still works as a text filter.
 *
 * @param {object} [links]
 *   Optional column linkage map. Currently supports:
 *     { categoryCol: number, subcategoryCol: number, categories: Array }
 *   When the category select changes, the subcategory select is rebuilt to
 *   show only that category's subcategories (or all if nothing selected).
 */
export function attachTableFilter(table, descriptors, links = {}) {
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  // ── Filter input row ────────────────────────────────────────────────────────
  const filterRow = document.createElement("tr");
  filterRow.className = "filter-row";

  // Keep refs to special cells for linkage
  const selects = {};  // col index → <select> element

  descriptors.forEach((desc, colIdx) => {
    const th = document.createElement("th");
    const type = normalizeType(desc);

    if (type === "text") {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "filter-input";
      input.placeholder = "Filter…";
      th.appendChild(input);

    } else if (type === "daterange") {
      const wrap = document.createElement("div");
      wrap.className = "filter-daterange";

      const from = document.createElement("input");
      from.type = "date";
      from.className = "filter-date";
      from.title = "From date";

      const to = document.createElement("input");
      to.type = "date";
      to.className = "filter-date";
      to.title = "To date";

      wrap.appendChild(from);
      wrap.appendChild(to);
      th.appendChild(wrap);

    } else if (type === "select") {
      const select = document.createElement("select");
      select.className = "filter-select";
      buildSelectOptions(select, desc.options);
      selects[colIdx] = select;
      th.appendChild(select);
    }

    filterRow.appendChild(th);
  });

  thead.appendChild(filterRow);

  // ── Category → Subcategory linkage ─────────────────────────────────────────
  if (
    links.categoryCol !== undefined &&
    links.subcategoryCol !== undefined &&
    links.categories
  ) {
    const catSelect = selects[links.categoryCol];
    const subSelect = selects[links.subcategoryCol];

    if (catSelect && subSelect) {
      catSelect.addEventListener("change", () => {
        const chosenCat = catSelect.value;
        // Rebuild subcategory options filtered to chosen category
        let subOptions;
        if (!chosenCat) {
          // All subcategories
          subOptions = links.categories.flatMap((c) =>
            c.subcategories.map((s) => s.name)
          );
        } else {
          const cat = links.categories.find((c) => c.name === chosenCat);
          subOptions = cat ? cat.subcategories.map((s) => s.name) : [];
        }
        // Deduplicate while preserving order
        subOptions = [...new Set(subOptions)];
        buildSelectOptions(subSelect, subOptions);
        applyFilters();
      });
    }
  }

  // ── Live filtering ──────────────────────────────────────────────────────────
  function applyFilters() {
    const ths = [...filterRow.querySelectorAll("th")];

    for (const row of tbody.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("td");
      let visible = true;

      ths.forEach((th, i) => {
        if (!visible) return;
        const type = normalizeType(descriptors[i]);
        const cellText = (cells[i]?.textContent ?? "").trim();

        if (type === "text") {
          const val = (th.querySelector("input")?.value ?? "").trim().toLowerCase();
          if (val && !cellText.toLowerCase().includes(val)) visible = false;

        } else if (type === "daterange") {
          const [from, to] = th.querySelectorAll("input");
          const fromVal = from?.value ?? "";
          const toVal = to?.value ?? "";
          if (fromVal && cellText < fromVal) visible = false;
          if (toVal && cellText > toVal) visible = false;

        } else if (type === "select") {
          const val = th.querySelector("select")?.value ?? "";
          if (val && cellText !== val) visible = false;
        }
      });

      row.style.display = visible ? "" : "none";
    }
  }

  filterRow.addEventListener("input", applyFilters);
  filterRow.addEventListener("change", applyFilters);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeType(desc) {
  if (!desc && desc !== 0) return null;
  if (desc === true || desc === "text") return "text";
  if (desc === "daterange") return "daterange";
  if (desc && typeof desc === "object" && desc.type === "select") return "select";
  return null;
}

function buildSelectOptions(select, options) {
  select.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "All";
  select.appendChild(blank);
  const sorted = [...new Set(options)].sort((a, b) => a.localeCompare(b));
  sorted.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  });
}
