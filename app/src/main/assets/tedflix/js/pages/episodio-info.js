import { errorDialog } from "../ui/dialogs.js";
import { el, limpar } from "../dom.js";
import { getTitulo as getTituloServidor, getEpisodios as getEpisodiosServidor } from "../server-api.js";
import { backdrop, poster } from "../img.js";
import { abrirPlayerNativo, lerProgresso, lerFavorito, toggleFavoritoComConfirmacao } from "../playback.js";
import { solicitarDownload, monitorarDownloadsNaTela } from "../downloads.js";

/** Tela de informações de um episódio retornado pelo Content Server v2. */
export default async function paginaEpisodioInfo(raiz, params) {
  const {
    temporada = 1,
    episodio = 1,
    categoria = "",
    slug = "",
    serieCategoria = "",
    serieSlug = "",
    serieTitulo = "",
    filmeId = "",
    thumb = "",
  } = params || {};

  const page = el("div", { class: "page page-ep-info" });
  raiz.append(page);
  // voltar: topbar (no lugar da logo)
  page.append(el("div", { class: "center detail-loading" }, [el("div", { class: "spinner" })]));

  const temp = Number(temporada) || 1;
  const epn = Number(episodio) || 1;
  let tituloSerie = serieTitulo || "";
  let tituloEp = `Episódio ${epn}`;
  let sinopse = "";
  let capa = thumb || "";
  let banner = "";
  let nota = null;
  let runtime = null;

  // Metadados do episódio já vêm da ficha agregada consultada no Content Server.
  try {
    const source = String(serieCategoria || categoria || "").toLowerCase();
    const episodeParts = String(slug || "").match(/^serie-(.+)-(\d+)-(\d+)$/i);
    const sourceSeriesSlug = serieSlug || episodeParts?.[1] || "";
    if (/^v[1-5]$/.test(source) && sourceSeriesSlug) {
      const [detail, episodes] = await Promise.all([
        getTituloServidor(source, sourceSeriesSlug, "series").catch(() => null),
        getEpisodiosServidor(source, sourceSeriesSlug, temp).catch(() => []),
      ]);
      tituloSerie = detail?.titulo || serieTitulo || sourceSeriesSlug;
      if (!capa) capa = detail?.poster || detail?.imagem || "";
      banner = detail?.backdrop || detail?.banner || capa;
      const hit = (episodes || []).find((episode) => Number(episode.numero) === epn);
      if (hit) {
        tituloEp = hit.titulo || tituloEp;
        capa = hit.imagem || capa;
        sinopse = hit.sinopse || sinopse;
        runtime = hit.duracao || runtime;
      }
      nota = detail?.nota ?? detail?.rating ?? null;
    }
  } catch (_) {}

  const playCategoria = String(serieCategoria || categoria || "").toLowerCase();
  const playSlug = slug;
  const playFilmeId = filmeId || slug;
  const prog = lerProgresso({
    categoria: playCategoria,
    slug: playSlug,
    filmeId: playFilmeId,
  });

  limpar(page);
const heroSrc = banner || capa;
  const hero = el("div", { class: "detail-hero ep-hero" });
  if (heroSrc) {
    hero.append(
      el("img", {
        src: backdrop(heroSrc, 780) || poster(capa, "lg") || heroSrc,
        alt: "",
        loading: "eager",
        onerror: "this.remove()",
      }),
    );
  } else {
    hero.append(el("div", { class: "thumb-placeholder thumb-placeholder--hero", "aria-hidden": "true" }));
  }
  hero.append(el("div", { class: "detail-hero-fade" }));
  page.append(hero);

  const corpo = el("div", { class: "pad ep-info-body" });
  corpo.append(el("p", { class: "sub" }, tituloSerie));
  corpo.append(
    el("h1", {}, `T${temp}E${epn} · ${tituloEp}`),
  );
  if (nota != null) corpo.append(el("p", { class: "tags" }, `★ ${nota}`));
  if (sinopse) corpo.append(el("p", { class: "sub", style: "line-height:1.45;margin-top:8px" }, sinopse));
  else corpo.append(el("p", { class: "sub", style: "margin-top:8px" }, "Sinopse indisponível para este episódio."));

  corpo.append(
    el("div", { class: "ep-progress-block", style: "margin-top:16px" }, [
      el("p", { class: "sub" }, `${prog.percent}% assistido`),
      el("div", { class: "ep-progress ep-progress--lg" }, [
        el("span", { style: `width:${prog.percent}%` }),
      ]),
    ]),
  );

  let favorito = lerFavorito(playFilmeId, playSlug);
  const favoritoBtn = el(
    "button",
    {
      class: `btn ghost${favorito ? " ativo" : ""}`,
      type: "button",
    },
    favorito ? "♥ Favorito" : "♡ Favoritar",
  );
  favoritoBtn.addEventListener("click", async () => {
    if (!window.AndroidPlayer?.toggleFavorite) return;
    try {
      const resposta = await toggleFavoritoComConfirmacao({
        filmeId: playFilmeId, slug: playSlug, categoria: playCategoria,
        titulo: `${tituloSerie} T${temp}E${epn}`, thumb: capa || "", tipo: "episodio",
      });
      if (!resposta.success) throw new Error(resposta.error || "Erro ao salvar");
      if (resposta.cancelled) return;
      favorito = typeof resposta.favorito === "boolean" ? resposta.favorito : !favorito;
      favoritoBtn.textContent = favorito ? "♥ Favorito" : "♡ Favoritar";
      favoritoBtn.classList.toggle("ativo", favorito);
    } catch (e) {
      errorDialog(e.message || "Não foi possível atualizar seus favoritos.", { title: "Favoritos indisponíveis", icon: "heart" });
      favoritoBtn.textContent = favorito ? "♥ Favorito" : "♡ Favoritar";
    }
  });

  const playLabel = prog.percent > 0 ? "▶ Continuar assistindo" : "▶ Assistir";
  const playBtn = el("button", { class: "btn primary", type: "button" }, playLabel);
  const downloadBtn = el("button", {
    class: "btn ghost ep-download-icon",
    type: "button",
    "aria-label": "Baixar episódio",
    title: "Baixar episódio para assistir offline",
  });
  downloadBtn.dataset.downloadId = String(`${playCategoria}_${playSlug}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>`;
  downloadBtn.addEventListener("click", () => {
    if (["downloading", "completed"].includes(downloadBtn.dataset.downloadState)) return;
    if (downloadBtn.dataset.downloadState === "paused" && window.AndroidPlayer?.resumeDownload) {
      try { window.AndroidPlayer.resumeDownload(downloadBtn.dataset.downloadId); } catch (_) {}
      return;
    }
    return solicitarDownload({
    categoria: playCategoria,
    slug: playSlug,
    titulo: `${tituloSerie} T${temp}E${epn} · ${tituloEp}`,
    thumb: capa || "",
    tipo: "episodio",
    filmeId: playFilmeId,
    serieCategoria: playCategoria,
    serieSlug: serieSlug || "",
    temporada: temp,
    episodio: epn,
    episodeTitle: tituloEp,
    seriesTitle: tituloSerie,
    sinopse,
  });
  });
  playBtn.addEventListener("click", async () => {
    const tituloPlay = `${tituloSerie} T${temp}E${epn}`;
    playBtn.disabled = true;
    playBtn.textContent = "Abrindo…";
    let todos = [];
    let fila = [];
    try {
      if (serieCategoria && serieSlug) {
        const parts = String(slug || "").match(/^serie-(.+)-(\d+)-(\d+)$/i);
        const sourceSeriesSlug = serieSlug || parts?.[1] || "";
        const sourceCategory = serieCategoria || categoria;
        const eps = await getEpisodiosServidor(sourceCategory, sourceSeriesSlug, temp).catch(() => []);
        const mapped = (eps || []).map((ep) => {
          const cat = ep.categoria || sourceCategory;
          const sl = ep.slug || "";
          return {
            categoria: cat,
            slug: sl,
            titulo: `${ep.numero || ""}. ${ep.titulo || ep.nome || "Episódio"}`,
            filmeId: sl,
            thumb: ep.imagem || "",
            tipo: "episodio",
            duracao: ep.duracao || "",
            numero: Number(ep.numero) || 0,
          };
        }).filter((x) => x.slug);
        todos = mapped;
        const idx = mapped.findIndex((x) => x.numero === epn || x.slug === slug);
        fila = idx >= 0 ? mapped.slice(idx + 1) : [];
      }
    } catch (_) {}
    if (
      abrirPlayerNativo({
        categoria: playCategoria,
        slug: playSlug,
        titulo: tituloPlay,
        thumb: capa || "",
        tipo: "episodio",
        filmeId: playFilmeId,
        serieCategoria: serieCategoria || categoria || "",
        serieSlug: serieSlug || String(slug || "").match(/^serie-(.+)-(\d+)-(\d+)$/i)?.[1] || "",
        fila,
        episodios: todos,
      })
    ) {
      playBtn.disabled = false;
      playBtn.textContent = playLabel;
      return;
    }
    const playParams = new URLSearchParams({
      tipo: "episodio",
      serieCategoria: playCategoria,
      serieSlug: serieSlug || String(playSlug || "").match(/^serie-(.+)-\d+-\d+$/i)?.[1] || "",
      filmeId: playFilmeId,
      thumb: capa || "",
    });
    location.hash = `#/assistir/${encodeURIComponent(playCategoria)}/${encodeURIComponent(playSlug)}?${playParams}`;
    playBtn.disabled = false;
    playBtn.textContent = playLabel;
  });

  corpo.append(
    el("div", { class: "ep-info-actions", style: "display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;padding-bottom:24px" }, [
      playBtn,
      downloadBtn,
      favoritoBtn,
    ]),
  );
  page.append(corpo);
  monitorarDownloadsNaTela(page);
  return page;
}
