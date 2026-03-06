export function createLoadingSpinner() {
  const el = document.createElement("span");
  el.className = "loading-spinner";
  el.setAttribute("aria-label", "Loading");
  return el;
}
