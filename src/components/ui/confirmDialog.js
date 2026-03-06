import { Modal } from "./modal.js";

export function showConfirmDialog({ title, message, onConfirm }) {
  const el = document.createElement("div");
  el.className = "confirm-dialog";
  el.innerHTML = `
    <h3>${escHtml(title)}</h3>
    <p>${escHtml(message)}</p>
    <div class="confirm-actions">
      <button class="btn btn-secondary" data-action="cancel">Cancel</button>
      <button class="btn btn-danger" data-action="confirm">Delete</button>
    </div>
  `;
  el.querySelector("[data-action='cancel']").addEventListener("click", () =>
    Modal.close()
  );
  el.querySelector("[data-action='confirm']").addEventListener("click", () => {
    Modal.close();
    onConfirm();
  });
  Modal.open(el);
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
