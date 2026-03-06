export function createErrorBanner(message) {
  const el = document.createElement("div");
  el.className = "error-banner";
  el.textContent = message;
  return el;
}
