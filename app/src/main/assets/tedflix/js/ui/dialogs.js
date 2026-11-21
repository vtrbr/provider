const ICON_PATHS = {
  trash: '<path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3m18 7V5a2 2 0 0 0-2-2h-5"/>',
  warning: '<path d="M12 3 2.8 19h18.4L12 3Z"/><path d="M12 9v4m0 3h.01"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6m0-6 6 6"/>',
  success: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3"/>',
};

function makeIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = ICON_PATHS[name] || ICON_PATHS.info;
  return svg;
}

function normalizeOptions(options = {}) {
  if (typeof options === "string") return { message: options };
  return options && typeof options === "object" ? options : {};
}

function openDialog(options, needsChoice) {
  const opts = normalizeOptions(options);
  const previous = document.querySelector(".tedflix-dialog-overlay");
  if (previous?._tedflixResolve) previous._tedflixResolve(false);

  return new Promise((resolve) => {
    const tone = ["danger", "success", "warning", "info"].includes(opts.tone)
      ? opts.tone
      : needsChoice ? "danger" : "info";
    const overlay = document.createElement("div");
    overlay.className = `tedflix-dialog-overlay tone-${tone}`;
    overlay.setAttribute("data-tedflix-dialog", "true");

    const dialog = document.createElement("section");
    dialog.className = "tedflix-dialog";
    dialog.setAttribute("role", needsChoice ? "alertdialog" : "dialog");
    dialog.setAttribute("aria-modal", "true");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tedflix-dialog-close";
    close.setAttribute("aria-label", "Fechar");
    close.textContent = "×";

    const iconWrap = document.createElement("div");
    iconWrap.className = "tedflix-dialog-icon";
    iconWrap.append(makeIcon(opts.icon || (needsChoice ? "warning" : "info")));

    const title = document.createElement("h2");
    title.className = "tedflix-dialog-title";
    title.textContent = String(opts.title || (needsChoice ? "Confirmar ação?" : "Aviso"));

    const message = document.createElement("p");
    message.className = "tedflix-dialog-message";
    message.textContent = String(opts.message || "");

    const actions = document.createElement("div");
    actions.className = `tedflix-dialog-actions${needsChoice ? " has-cancel" : ""}`;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "tedflix-dialog-btn secondary";
    cancel.textContent = String(opts.cancelText || "Cancelar");

    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "tedflix-dialog-btn primary";
    accept.textContent = String(opts.confirmText || (needsChoice ? "Confirmar" : opts.buttonText || "Entendi"));

    let finished = false;
    const previousOverflow = document.body.style.overflow;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      overlay.classList.add("is-closing");
      window.setTimeout(() => overlay.remove(), 180);
      resolve(Boolean(value));
    };
    overlay._tedflixResolve = finish;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      } else if (event.key === "Tab") {
        const focusable = [...dialog.querySelectorAll("button:not(:disabled)")];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };

    close.addEventListener("click", () => finish(false));
    accept.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(false);
    });

    if (needsChoice) actions.append(cancel, accept);
    else actions.append(accept);
    dialog.append(close, iconWrap, title, message, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    window.requestAnimationFrame(() => {
      overlay.classList.add("is-visible");
      (needsChoice ? cancel : accept).focus({ preventScroll: true });
    });
  });
}

export function confirmDialog(options = {}) {
  return openDialog(options, true);
}

export function noticeDialog(options = {}) {
  return openDialog(options, false);
}

export function errorDialog(message, options = {}) {
  const opts = normalizeOptions(options);
  return noticeDialog({ tone: "danger", icon: "error", title: "Não foi possível concluir", ...opts, message: String(message || opts.message || "Ocorreu um erro inesperado.") });
}

export function successDialog(message, options = {}) {
  const opts = normalizeOptions(options);
  return noticeDialog({ tone: "success", icon: "success", title: "Tudo certo!", ...opts, message: String(message || opts.message || "Operação concluída.") });
}

export function confirmFavoriteRemoval(title) {
  return confirmDialog({
    tone: "danger",
    icon: "heart",
    title: "Remover dos favoritos?",
    message: `Deseja remover “${String(title || "este conteúdo")}” da sua lista?`,
    confirmText: "Remover",
    cancelText: "Cancelar",
  });
}

// API central para fluxos que não importam o módulo diretamente.
if (typeof window !== "undefined") {
  window.TedflixDialog = Object.freeze({
    confirm: confirmDialog,
    alert: noticeDialog,
    error: errorDialog,
    success: successDialog,
    confirmFavoriteRemoval,
  });
}
