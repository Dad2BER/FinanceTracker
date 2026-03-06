const TAX_TYPE_CLASSES = {
  "Taxable": "badge-taxable",
  "Tax-Free": "badge-tax-free",
  "Tax-Deferred": "badge-tax-deferred",
};

export function createTaxTypeBadge(taxType) {
  const el = document.createElement("span");
  el.className = `tax-badge ${TAX_TYPE_CLASSES[taxType] || ""}`;
  el.textContent = taxType;
  return el;
}
