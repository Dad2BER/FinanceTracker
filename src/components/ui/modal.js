/**
 * Modal — generic backdrop + card.
 * Usage: Modal.open(contentEl) / Modal.close()
 */
const backdrop = document.createElement("div");
backdrop.className = "modal-backdrop";

const card = document.createElement("div");
card.className = "modal-card";
backdrop.appendChild(card);

let _onClose = null;

function close() {
  backdrop.remove();
  if (_onClose) _onClose();
  _onClose = null;
}

backdrop.addEventListener("click", (e) => {
  if (e.target === backdrop) close();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && backdrop.isConnected) close();
});

export const Modal = {
  open(contentEl, onClose, options = {}) {
    card.innerHTML = "";
    card.classList.toggle("modal-card-wide", !!options.wide);
    card.appendChild(contentEl);
    _onClose = onClose || null;
    document.body.appendChild(backdrop);
  },
  close,
};
