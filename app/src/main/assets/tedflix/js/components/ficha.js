import { el, limpar } from "../dom.js";

/** Extrai cor dominante aproximada da capa para o gradiente. */
export function aplicarGradienteDaCapa(imgEl, targetEl) {
  if (!imgEl || !targetEl) return;
  const apply = () => {
    try {
      const c = document.createElement("canvas");
      const w = 32;
      const h = 48;
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(imgEl, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 16) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2], a = data[i + 3];
        if (a < 120) continue;
        // ignora quase branco/preto puro
        const mx = Math.max(pr, pg, pb);
        const mn = Math.min(pr, pg, pb);
        if (mx < 25 || mn > 230) continue;
        r += pr; g += pg; b += pb; n++;
      }
      if (!n) return;
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      // escurece para fundo cinematográfico
      const dr = Math.round(r * 0.35);
      const dg = Math.round(g * 0.35);
      const db = Math.round(b * 0.35);
      targetEl.style.setProperty("--ficha-c1", `rgb(${dr},${dg},${db})`);
      targetEl.style.setProperty("--ficha-c2", `rgb(${Math.round(r * 0.18)},${Math.round(g * 0.18)},${Math.round(b * 0.18)})`);
    } catch (_) {}
  };
  if (imgEl.complete && imgEl.naturalWidth) apply();
  else imgEl.addEventListener("load", apply, { once: true });
}

function metaLine(parts) {
  return parts.filter(Boolean).map(String);
}

function sinopseBloco(texto) {
  const full = String(texto || "").trim();
  if (!full) return null;
  const wrap = el("div", { class: "ficha-sinopse" });
  const p = el("p", { class: "ficha-sinopse-txt is-clamp" }, full);
  wrap.append(p);
  if (full.length > 220) {
    const btn = el("button", { type: "button", class: "ficha-mais" }, "Mais");
    let aberto = false;
    btn.onclick = () => {
      aberto = !aberto;
      p.classList.toggle("is-clamp", !aberto);
      btn.textContent = aberto ? "Menos" : "Mais";
    };
    wrap.append(btn);
  }
  return wrap;
}

/**
 * Monta o shell visual da ficha (filme ou série).
 * opts:
 *  - titulo, poster vertical, nota, ano, tipoLabel, duracao, temps, classificacao, generos[]
 *  - sinopse
 *  - onPlay, onFavorite, favorito, playLabel
 *  - extraActions: HTMLElement[]
 *  - after: HTMLElement[] (episódios, trailer…)
 *  - onBack
 */
export function montarFicha(opts = {}) {
  const root = el("div", { class: "ficha" });

  // topo flutuante
  const top = el("div", { class: "ficha-top" });
  const back = el("button", { type: "button", class: "ficha-icon-btn", "aria-label": "Voltar" });
  back.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg>`;
  back.onclick = () => {
    if (typeof opts.onBack === "function") opts.onBack();
    else if (history.length > 1) history.back();
    else location.hash = "#/";
  };
  top.append(back);
  root.append(top);

  // Pôster vertical centralizado. O fundo é somente um gradiente próprio:
  // não reutilizamos a capa ampliada/desfocada atrás do pôster.
  const posterUrl = opts.poster || opts.capa || opts.imagem || "";
  const hero = el("div", { class: "ficha-hero" });
  const img = el("img", {
    class: "ficha-poster-image",
    alt: opts.titulo || "",
    src: posterUrl || "",
    decoding: "async",
    fetchpriority: "high",
  });
  if (!posterUrl) img.style.display = "none";
  img.addEventListener("error", () => {
    img.style.display = "none";
    hero.classList.add("is-placeholder");
  });
  hero.append(img);
  if (!posterUrl) hero.classList.add("is-placeholder");
  root.append(hero);

  // Título e metadados ficam logo abaixo da capa, centralizados.
  const body = el("div", { class: "ficha-body" });
  body.append(el("span", { class: "ficha-kicker" }, "TEDFLIX"));
  body.append(el("h1", { class: "ficha-title" }, opts.titulo || ""));

  const metaParts = metaLine([
    opts.nota != null && Number(opts.nota) > 0 ? `★ ${Number(opts.nota).toFixed(1)}` : null,
    opts.ano ? String(opts.ano).slice(0, 4) : null,
    opts.tipoLabel || null,
    opts.duracao ? `${opts.duracao} min` : null,
    opts.temps ? `${opts.temps} temporada${Number(opts.temps) > 1 ? "s" : ""}` : null,
  ]);
  if (metaParts.length) {
    const row = el("div", { class: "ficha-meta" });
    metaParts.forEach((m, i) => {
      if (i) row.append(el("span", { class: "ficha-dot" }, "·"));
      row.append(el("span", {}, m));
    });
    if (opts.classificacao) {
      row.append(el("span", { class: "ficha-badge" }, String(opts.classificacao)));
    }
    body.append(row);
  }

  if (opts.progress != null) {
    const percent = Math.max(0, Math.min(100, Number(opts.progress) || 0));
    body.append(el("div", { class: "ep-progress-block ficha-progress-inline" }, [
      el("p", { class: "sub" }, `${percent}% assistido`),
      el("div", { class: "ep-progress ep-progress--lg" }, [
        el("span", { style: `width:${percent}%` }),
      ]),
    ]));
  }

  if (Array.isArray(opts.generos) && opts.generos.length) {
    const chips = el("div", { class: "ficha-genres" });
    opts.generos.slice(0, 5).forEach((g) => {
      const label = typeof g === "string" ? g : g?.nome || g?.name || "";
      if (label) chips.append(el("span", { class: "ficha-genre" }, label));
    });
    body.append(chips);
  }

  // ações
  const actions = el("div", { class: "ficha-actions" });
  const play = el("button", { type: "button", class: "ficha-btn-play" }, [
    el("span", { class: "ficha-play-ico", html: "▶" }),
    el("span", {}, opts.playLabel || "Assistir"),
  ]);
  if (typeof opts.onPlay === "function") play.onclick = opts.onPlay;
  if (opts.playDisabled) {
    play.disabled = true;
    play.title = "Esta fonte não disponibiliza reprodução pelo aplicativo.";
    play.setAttribute("aria-disabled", "true");
  }
  actions.append(play);

  const fav = el(
    "button",
    {
      type: "button",
      class: `ficha-btn-sec${opts.favorito ? " is-on" : ""}`,
    },
    opts.favorito ? "♥ Na lista" : "♡ Favoritar",
  );
  if (typeof opts.onFavorite === "function") {
    fav.onclick = async () => {
      if (fav.disabled) return;
      fav.disabled = true;
      try {
        const r = await opts.onFavorite();
        if (r && typeof r.favorito === "boolean") {
          fav.textContent = r.favorito ? "♥ Na lista" : "♡ Favoritar";
          fav.classList.toggle("is-on", r.favorito);
        }
      } finally {
        fav.disabled = false;
      }
    };
  }
  actions.append(fav);
  if (typeof opts.onDownload === "function") {
    const download = el("button", { type: "button", class: "ficha-btn-icon ficha-btn-download", "aria-label": "Baixar", title: "Baixar para assistir offline" });
    download.dataset.downloadId = String(opts.downloadId || "");
    if (opts.downloadDisabled) { download.disabled = true; download.title = "Download indisponível nesta fonte."; }
    if (opts.downloadSeriesKey) download.dataset.downloadSeriesKey = String(opts.downloadSeriesKey);
    download.innerHTML = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>`;
    download.onclick = async () => {
      if (["downloading", "completed"].includes(download.dataset.downloadState)) return;
      if (download.dataset.downloadState === "paused") {
        try {
          if (download.dataset.downloadSeriesKey && window.AndroidPlayer?.resumeAllDownloads) {
            window.AndroidPlayer.resumeAllDownloads();
          } else if (window.AndroidPlayer?.resumeDownload) {
            window.AndroidPlayer.resumeDownload(download.dataset.downloadId);
          }
        } catch (_) {}
        return;
      }
      download.disabled = true;
      try { await opts.onDownload(); } finally { download.disabled = false; }
    };
    actions.append(download);
  }

  const mark = el("button", { type: "button", class: "ficha-btn-icon", "aria-label": "Salvar" });
  mark.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 4h12v16l-6-4-6 4z"/></svg>`;
  if (typeof opts.onFavorite === "function") mark.onclick = fav.onclick;
  actions.append(mark);
  body.append(actions);

  const sin = sinopseBloco(opts.sinopse);
  if (sin) body.append(sin);

  root.append(body);

  if (Array.isArray(opts.after)) {
    opts.after.forEach((node) => {
      if (node) root.append(node);
    });
  }

  return root;
}

/** Trailer sob demanda, abaixo das informações; nunca substitui o pôster do topo. */
export function montarTrailerUI(trailerId, titulo = "") {
  const id = String(trailerId || "").trim();
  if (!id) return null;
  const section = el("section", { class: "ficha-trailer-section" });
  section.append(el("h2", { class: "ficha-eps-title" }, "TRAILER"));
  const preview = el("button", {
    type: "button",
    class: "ficha-trailer-preview",
    "aria-label": `Reproduzir trailer de ${titulo || "conteúdo"}`,
  });
  const image = el("img", {
    src: `https://img.youtube.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`,
    alt: `Trailer de ${titulo || "conteúdo"}`,
    loading: "lazy",
    decoding: "async",
  });
  image.addEventListener("error", () => { image.style.display = "none"; });
  preview.append(image, el("span", { class: "ficha-trailer-play", "aria-hidden": "true" }, "▶"));
  preview.addEventListener("click", () => {
    const video = el("iframe", {
      class: "ficha-trailer-video",
      src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1`,
      title: `Trailer de ${titulo || "conteúdo"}`,
      allow: "autoplay; encrypted-media; picture-in-picture",
      allowfullscreen: "true",
      loading: "lazy",
    });
    preview.replaceWith(video);
  }, { once: true });
  section.append(preview);
  return section;
}

/** Chips de temporada + lista de episódios no estilo da referência. */
export function montarEpisodiosUI({
  temporadas = [],
  temporadaAtiva = 1,
  onSelectTemp,
  onPlayEp,
  onDownloadEp,
  serieCapa = "",
  playDisabled = false,
  downloadDisabled = false,
} = {}) {
  const sec = el("section", { class: "ficha-eps" });
  sec.append(el("h2", { class: "ficha-eps-title" }, "Episódios"));

  const seasonWrap = el("div", { class: "ficha-season-wrap" });
  const seasonSelect = document.createElement("select");
  seasonSelect.className = "ficha-season-select";
  seasonSelect.setAttribute("aria-label", "Selecionar temporada");
  const list = el("div", { class: "ficha-ep-list" });

  const renderList = (num) => {
    limpar(list);
    const t = temporadas.find((x) => Number(x.numero) === Number(num)) || temporadas[0];
    const eps = (t && (t.episodios || t.episodes)) || [];
    if (!eps.length) {
      list.append(el("p", { class: "sub" }, "Nenhum episódio nesta temporada."));
      return;
    }
    eps.forEach((ep, i) => {
      const n = ep.numero ?? ep.episode_number ?? i;
      const titulo = ep.titulo || ep.nome || ep.name || `Episódio ${n}`;
      const thumb = ep.imagem || ep.thumb || ep.still || serieCapa || "";
      const dur = ep.duracao || ep.runtime || ep.duration || null;
      const row = el("div", { class: "ficha-ep-row" });
      const left = el("button", { type: "button", class: "ficha-ep-main" });
      const img = el("div", { class: "ficha-ep-thumb" });
      if (thumb) {
        img.append(el("img", { src: thumb, alt: "", loading: "lazy" }));
      }
      img.append(el("span", { class: "ficha-ep-play" }, "▶"));
      left.append(img);
      const info = el("div", { class: "ficha-ep-info" });
      info.append(el("div", { class: "ficha-ep-name" }, `E${n} · ${titulo}`));
      if (dur) info.append(el("div", { class: "ficha-ep-dur" }, `${dur} min`));
      if (ep.progresso != null) {
        const percent = Math.max(0, Math.min(100, Number(ep.progresso) || 0));
        info.append(el("div", { class: "ep-progress ficha-ep-progress" }, [
          el("span", { style: `width:${percent}%` }),
        ]));
      }
      left.append(info);
      left.onclick = () => { if (!playDisabled && onPlayEp) onPlayEp(ep, num, n); };
      if (playDisabled) { left.disabled = true; left.setAttribute("aria-disabled", "true"); }
      row.append(left);
      if (typeof onDownloadEp === "function") {
        const dl = el("button", { type: "button", class: "ficha-ep-download", "aria-label": `Baixar episódio ${n}`, title: "Baixar episódio" });
        const sourceCategory = ep.categoria || ep.source || "";
        const sourceSlug = ep.slug || "";
        dl.dataset.downloadId = String(`${sourceCategory}_${sourceSlug}`).replace(/[^a-zA-Z0-9_-]/g, "_");
        if (downloadDisabled) { dl.disabled = true; dl.title = "Download indisponível nesta fonte."; }
        dl.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>`;
        dl.onclick = (event) => {
          event.stopPropagation();
          if (["downloading", "completed"].includes(dl.dataset.downloadState)) return;
          if (dl.dataset.downloadState === "paused" && window.AndroidPlayer?.resumeDownload) {
            try { window.AndroidPlayer.resumeDownload(dl.dataset.downloadId); } catch (_) {}
            return;
          }
          onDownloadEp(ep, num, n);
        };
        row.append(dl);
      }
      list.append(row);
    });
  };

  const temporadasDisponiveis = temporadas.length ? temporadas : [{ numero: 1, episodios: [] }];
  temporadasDisponiveis.forEach((t) => {
    const n = t.numero || t.season_number || 1;
    const option = document.createElement("option");
    option.value = String(n);
    option.textContent = `Temporada ${n}`;
    seasonSelect.append(option);
  });
  seasonSelect.addEventListener("change", () => {
    const num = Number(seasonSelect.value) || 1;
    renderList(num);
    if (typeof onSelectTemp === "function") onSelectTemp(num);
  });
  seasonWrap.append(seasonSelect);
  sec.append(seasonWrap, list);

  const inicial = temporadaAtiva || (temporadasDisponiveis[0] && (temporadasDisponiveis[0].numero || 1)) || 1;
  seasonSelect.value = String(inicial);
  renderList(inicial);

  return sec;
}
