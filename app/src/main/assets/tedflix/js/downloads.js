import { errorDialog, noticeDialog } from "./ui/dialogs.js";
/**
 * Ponte única para iniciar downloads usando a mesma resolução nativa do player.
 * O Android abre uma Activity transparente de resolução; a URL final nunca é reconstruída no JS.
 */
export function solicitarDownload(item = {}) {
  const bridge = window.AndroidPlayer;
  if (!bridge || typeof bridge.downloadContent !== "function") {
    noticeDialog({ tone: "warning", icon: "download", title: "Atualização necessária", message: "Downloads exigem a versão Android atualizada do TEDFLIX." });
    return false;
  }
  const payload = {
    id: String(item.id || `${item.categoria || item.source || "media"}_${item.slug || item.filmeId || Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
    overview: item.sinopse || item.overview || "",
    year: item.ano || item.year || "",
    duration: item.duracao || "",
    source: item.source || item.categoria || "",
    season: item.temporada || 0,
    episode: item.episodio || 0,
    episodeTitle: item.episodeTitle || "",
    seriesTitle: item.seriesTitle || item.serieTitulo || "",
  };
  try {
    const result = JSON.parse(bridge.downloadContent(
      item.categoria || item.source || "",
      item.slug || "",
      item.titulo || item.title || "Tedflix",
      item.thumb || item.poster || "",
      item.tipo || item.mediaType || "filme",
      item.filmeId || item.id || item.slug || "",
      JSON.stringify(payload),
      item.serieCategoria || "",
      item.serieSlug || "",
    ) || "{}");
    if (!result.success) throw new Error(result.error || "Não foi possível iniciar");
    // Toast nativo já confirma; evita abrir qualquer tela extra no JS
    return true;
  } catch (error) {
    errorDialog(error.message || "Não foi possível iniciar o download.", { title: "Download não iniciado", icon: "download" });
    return false;
  }
}


export function solicitarFilaDownloads(items = []) {
  const bridge = window.AndroidPlayer;
  if (!Array.isArray(items) || !items.length) {
    noticeDialog({ tone: "warning", icon: "download", title: "Nenhum episódio disponível", message: "Não há episódios disponíveis para adicionar à fila de downloads." });
    return false;
  }
  if (!bridge || typeof bridge.enqueueDownloadQueue !== "function") {
    noticeDialog({ tone: "warning", icon: "download", title: "Atualização necessária", message: "Atualize o TEDFLIX para baixar uma série inteira." });
    return false;
  }
  try {
    const payload = items.map((item) => ({
      id: String(item.id || `${item.categoria}_${item.slug}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
      categoria: item.categoria || "",
      slug: item.slug || "",
      titulo: item.titulo || "Episódio",
      thumb: item.thumb || "",
      tipo: item.tipo || "episodio",
      filmeId: item.filmeId || item.slug || "",
      serieCategoria: item.serieCategoria || "",
      serieSlug: item.serieSlug || "",
      metadata: JSON.stringify(item.metadata || {}),
    }));
    const result = JSON.parse(bridge.enqueueDownloadQueue(JSON.stringify(payload)) || "{}");
    if (!result.success) throw new Error(result.error || "Não foi possível iniciar a fila.");
    return true;
  } catch (error) {
    errorDialog(error.message || "Não foi possível iniciar os downloads.", { title: "Downloads não iniciados", icon: "download" });
    return false;
  }
}


/** Atualiza os botões da tela com o estado real reportado pelo DownloadManager. */
export function monitorarDownloadsNaTela(container = document) {
  const bridge = window.AndroidPlayer;
  if (!bridge || typeof bridge.getDownloads !== "function" || !container) return () => {};
  let stopped = false;
  let timer = null;
  const desenhar = (botao, item) => {
    const state = item ? Number(item.state) : -1;
    const percent = Math.max(0, Math.min(100, Number(item?.percent) || 0));
    botao.dataset.downloadState = state === 3 ? "completed" : state === 2 || state === 0 || state === 6 || state === 7 ? "downloading" : state === 1 ? "paused" : state === 4 ? "failed" : "idle";
    botao.setAttribute("aria-label", state === 3 ? "Baixado" : state === 2 ? `Baixando ${percent}%` : state === 1 ? "Download pausado" : state === 4 ? "Falha no download" : "Baixar");
    if (state === 3) {
      botao.innerHTML = `<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"/></svg>`;
      botao.classList.add("is-downloaded");
    } else if (state === 2 || state === 0 || state === 6 || state === 7) {
      const radius = 9, circumference = 2 * Math.PI * radius;
      const offset = circumference - (percent / 100) * circumference;
      botao.innerHTML = `<svg viewBox="0 0 24 24" width="25" height="25" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="2"/><circle cx="12" cy="12" r="9" fill="none" stroke="#e50914" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 12 12)"/></svg>`;
      botao.classList.remove("is-downloaded");
    } else if (state === 1) {
      botao.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 5h4v14H7zM15 5h4v14h-4z"/></svg>`;
      botao.classList.remove("is-downloaded");
    } else if (state === 4) {
      botao.innerHTML = `<span class="nf-download-failed">!</span>`;
      botao.classList.remove("is-downloaded");
    } else {
      botao.innerHTML = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>`;
      botao.classList.remove("is-downloaded");
    }
  };
  const update = () => {
    if (stopped || container !== document && !container.isConnected) { stopped = true; clearInterval(timer); return; }
    try {
      const raw = bridge.getDownloads();
      const result = typeof raw === "string" ? JSON.parse(raw) : raw;
      let items = result?.items;
      if (typeof items === "string") items = JSON.parse(items);
      const list = Array.isArray(items) ? items : [];
      const byId = new Map(list.map((item) => [String(item.id), item]));
      const bySeries = new Map();
      list.forEach((item) => {
        const key = String(item.seriesKey || "").trim();
        if (!key) return;
        if (!bySeries.has(key)) bySeries.set(key, []);
        bySeries.get(key).push(item);
      });
      container.querySelectorAll("[data-download-id]").forEach((button) => {
        const seriesKey = String(button.dataset.downloadSeriesKey || "").trim();
        if (seriesKey) {
          const group = bySeries.get(seriesKey) || [];
          if (!group.length) { desenhar(button, null); return; }
          const expected = Math.max(0, ...group.map((item) => Number(item.seriesTotalEpisodes) || 0));
          const completed = group.filter((item) => Number(item.state) === 3).length;
          const percent = expected > 0
            ? Math.round(group.reduce((sum, item) => sum + Math.max(0, Number(item.percent) || 0), 0) / expected)
            : Math.round(group.reduce((sum, item) => sum + Math.max(0, Number(item.percent) || 0), 0) / group.length);
          const allResolved = expected > 0 && group.length >= expected;
          const allCompleted = allResolved && completed >= expected && group.every((item) => Number(item.state) === 3);
          const hasFailure = group.some((item) => Number(item.state) === 4);
          const unfinished = group.filter((item) => Number(item.state) !== 3);
          const allPaused = unfinished.length > 0 && unfinished.every((item) => Number(item.state) === 1);
          desenhar(button, {
            state: allCompleted ? 3 : hasFailure ? 4 : allPaused ? 1 : 2,
            percent: allCompleted ? 100 : percent,
          });
          return;
        }
        const item = byId.get(String(button.dataset.downloadId || ""));
        desenhar(button, item);
      });
    } catch (_) {}
  };
  update();
  const startPolling = () => {
    if (stopped || timer || document.hidden) return;
    timer = setInterval(update, 3000);
  };
  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (document.hidden) stopPolling();
    else { update(); startPolling(); }
  };
  document.addEventListener("visibilitychange", onVisibility);
  startPolling();
  return () => {
    stopped = true;
    stopPolling();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
