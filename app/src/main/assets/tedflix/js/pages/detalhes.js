import { errorDialog } from "../ui/dialogs.js";
import { el, limpar, anoCurto } from "../dom.js";
import { getTitulo, getTemporadas, getEpisodios, parseLink, extrairYoutubeId } from "../server-api.js";
import { lerProgresso, lerFavorito, mapaProgresso, toggleFavoritoComConfirmacao } from "../playback.js";
import { solicitarDownload, solicitarFilaDownloads, monitorarDownloadsNaTela } from "../downloads.js";
import { cardTitulo } from "../components/card.js";
import { poster as imagemPoster } from "../img.js";
import { montarFicha, montarEpisodiosUI, montarTrailerUI } from "../components/ficha.js";

function dadosParaPlayer(item) {
  if (!item) return null;
  const p = parseLink(item.link_assistir || item.link);
  const categoria = item.categoria || p.categoria;
  const slug = item.slug || p.slug;
  if (!categoria || !slug) return null;
  return {
    categoria,
    slug,
    filmeId: String(item.filmeId || item.id || item._id || slug),
    thumb: item.imagem || item.thumb || "",
    titulo: item.titulo || "",
    tipo: item.tipo || "filme",
  };
}

export default async function paginaDetalhe(raiz, { tipo, categoria, slug, sourceSlug = "" }) {
  document.body.classList.add("ficha-mode");
  const page = el("div", { class: "page page-ficha" });
  raiz.append(page);
  page.append(el("div", { class: "center detail-loading" }, [el("div", { class: "spinner" })]));

  let dados;
  try {
    dados = await getTitulo(categoria, slug, tipo, sourceSlug);
  } catch (e) {
    limpar(page);
    errorDialog(e?.message || "Não foi possível carregar este título.", { title: "Título indisponível" });
    page.append(el("p", { class: "center" }, "Não foi possível carregar este título."));
    return page;
  }

  if (!dados.titulo && dados.serie) dados.titulo = dados.serie;
  if (!dados.slug) dados.slug = slug;
  if (!dados.categoria) dados.categoria = categoria;
  // Fallback: arte/título do card que abriu a ficha (evita capa preta e título vazio)
  try {
    const cached = JSON.parse(sessionStorage.getItem("tedflix:lastCard") || "null");
    if (cached && (String(cached.slug) === String(slug) || String(cached.filmeId) === String(slug) || String(cached.sourceId) === String(slug))) {
      if (!dados.titulo || /^\d+$/.test(dados.titulo) || /^s\d/i.test(dados.titulo)) {
        dados.titulo = cached.titulo || cached.title || dados.titulo;
      }
      if (!dados.poster && !dados.capa && !dados.imagem) {
        dados.poster = cached.poster || cached.imagem || cached.capa || "";
        dados.capa = dados.poster;
        dados.imagem = dados.poster;
      }
      if (!dados.sinopse && cached.sinopse) dados.sinopse = cached.sinopse;
    }
  } catch (_) {}

  const isSerie = tipo === "serie" || /sér|ser/i.test(String(dados.tipo || ""));
  const filmeId = String(dados.filmeId || dados.id || dados._id || dados.tmdb_id || slug);
  // Prioriza sempre a arte vertical do título; banner/backdrop horizontal não
  // deve substituir o pôster na ficha. Normaliza caminhos TMDB relativos.
  const posterCandidate = String(
    dados.poster || dados.capa || dados.imagem || dados.thumb || "",
  ).trim();
  const tmdbPosterPath = String(dados.poster_path || "").trim();
  const posterRaw = posterCandidate || (tmdbPosterPath
    ? `https://image.tmdb.org/t/p/w500${tmdbPosterPath.startsWith("/") ? tmdbPosterPath : `/${tmdbPosterPath}`}`
    : "");
  const posterAbsolute = posterRaw.startsWith("//") ? `https:${posterRaw}` : posterRaw;
  const thumb = imagemPoster(posterAbsolute, "md") || "";
  let favorito = lerFavorito(filmeId, slug, categoria);
  const pctFilme = lerProgresso({ categoria, slug, filmeId }).percent;

  const after = [];
  let episodiosParaDownload = [];

  // Episódios (série)
  if (isSerie) {
    const epsSection = el("div", { class: "ficha-eps-host" });
    epsSection.append(el("div", { class: "center" }, [el("div", { class: "spinner" })]));
    after.push(epsSection);
    // carrega async
    (async () => {
      try {
        const temporadas = await getTemporadas(categoria, slug);
        const tempsData = [];
        for (const t of temporadas || []) {
          const num = t.numero || t.season_number || 1;
          let eps = [];
          try {
            eps = await getEpisodios(categoria, slug, num);
          } catch (_) {}
          tempsData.push({
            numero: num,
            episodios: (eps || []).map((ep, i) => ({
              ...ep,
              numero: ep.numero ?? i + 1,
              titulo: ep.titulo || ep.nome || "",
              imagem: ep.imagem || ep.thumb || thumb,
              duracao: ep.duracao || "",
              categoria: ep.categoria || categoria,
              slug: ep.slug || parseLink(ep.link || ep.link_assistir).slug,
              progresso: lerProgresso({
                categoria: ep.categoria || categoria,
                slug: ep.slug || parseLink(ep.link || ep.link_assistir).slug,
                filmeId: ep.filmeId || ep.id || ep.slug || "",
              }).percent,
            })),
          });
        }
        episodiosParaDownload = tempsData;
        limpar(epsSection);
        if (!tempsData.length) {
          epsSection.append(el("p", { class: "sub", style: "padding:16px" }, "Episódios indisponíveis."));
          return;
        }
        epsSection.append(
          montarEpisodiosUI({
            temporadas: tempsData,
            serieCapa: thumb,
            playDisabled: dados.pode_assistir === false,
            downloadDisabled: dados.pode_assistir === false,
            onDownloadEp: (ep, temp, num) => {
              const p = parseLink(ep.link || ep.link_assistir);
              const cat = ep.categoria || p.categoria || categoria;
              const sl = ep.slug || p.slug;
              if (!sl) return;
              return solicitarDownload({
                categoria: cat, slug: sl,
                titulo: `${dados.titulo || "Série"} · T${temp}E${num} · ${ep.titulo || ""}`,
                thumb: ep.imagem || thumb,
                filmeId: ep.filmeId || ep.id || sl,
                tipo: "episodio", serieCategoria: categoria, serieSlug: slug, titulo: `${dados.titulo || ""}`,
                temporada: temp, episodio: num, episodeTitle: ep.titulo || "",
                seriesTitle: dados.titulo || "", sinopse: ep.sinopse || "",
              });
            },
            onPlayEp: (ep, temp, num) => {
              const p = parseLink(ep.link || ep.link_assistir);
              const cat = ep.categoria || p.categoria || categoria;
              const sl = ep.slug || p.slug;
              if (!sl) return;
              const params = new URLSearchParams({
                filmeId: String(ep.filmeId || ep.id || sl),
                thumb: ep.imagem || thumb,
                tipo: "episodio",
                serieCategoria: categoria,
                serieSlug: slug,
              });
              location.hash = `#/assistir/${encodeURIComponent(cat)}/${encodeURIComponent(sl)}?${params}`;
            },
          }),
        );
      } catch (_) {
        limpar(epsSection);
        epsSection.append(el("p", { class: "sub", style: "padding:16px" }, "Episódios indisponíveis."));
      }
    })();
  }

  // Trailer
  const trailerUrl = dados.trailer || null;
  const trailerId = extrairYoutubeId(trailerUrl);
  const trailerSection = montarTrailerUI(trailerId, dados.titulo || "");
  if (trailerSection) after.push(trailerSection);

  // Recomendados
  if ((dados.recomendados || []).length) {
    const rail = el("div", { class: "rail" });
    dados.recomendados.slice(0, 16).forEach((r) => rail.append(cardTitulo(r)));
    after.push(
      el("section", { class: "trailer-section" }, [
        el("h2", { class: "ficha-eps-title" }, "Recomendados"),
        rail,
      ]),
    );
  }

  const generos = (dados.generos || []).map((g) =>
    typeof g === "string" ? g : g?.nome || g?.name || "",
  );

  limpar(page);
  page.append(
    montarFicha({
      titulo: dados.titulo || "",
      poster: thumb,
      downloadId: String(`${categoria}_${slug}`).replace(/[^a-zA-Z0-9_-]/g, "_"),
      downloadSeriesKey: isSerie ? String(`${categoria}_${slug}`).replace(/[^a-zA-Z0-9_-]/g, "_") : "",
      nota: dados.nota,
      ano: anoCurto(dados.ano) || dados.ano,
      tipoLabel: isSerie ? "Série" : "Filme",
      duracao: !isSerie ? dados.duracao : null,
      temps: isSerie
        ? dados.total_temporadas || dados.temporadas?.length || null
        : null,
      classificacao: dados.classificacao || dados.age || null,
      generos,
      sinopse: dados.descricao || dados.sinopse || dados.overview || "",
      progress: pctFilme,
      favorito,
      playDisabled: dados.pode_assistir === false,
      downloadDisabled: dados.pode_assistir === false,
      playLabel: dados.pode_assistir === false
        ? "Indisponível nesta fonte"
        : isSerie
        ? "Assistir"
        : pctFilme > 0
          ? `Continuar · ${pctFilme}%`
          : "Assistir",
      onPlay: () => {
        if (dados.pode_assistir === false) return;
        if (isSerie) {
          const host = page.querySelector(".ficha-ep-main");
          if (host) host.click();
          else {
            const ep = page.querySelector(".ficha-eps");
            if (ep) ep.scrollIntoView({ behavior: "smooth" });
          }
          return;
        }
        const params = new URLSearchParams({
          filmeId,
          thumb,
          tipo: dados.tipo || tipo || "filme",
          titulo: dados.titulo || "",
        });
        const recomendados = (dados.recomendados || []).map(dadosParaPlayer).filter(Boolean);
        if (recomendados.length) params.set("recomendados", JSON.stringify(recomendados));
        location.hash = `#/assistir/${encodeURIComponent(categoria)}/${encodeURIComponent(slug)}?${params}`;
      },
      onDownload: () => {
        if (dados.pode_assistir === false) return;
        if (isSerie) {
          const totalEpisodios = episodiosParaDownload.reduce((total, temp) => total + (temp.episodios || []).filter((ep) => {
            const parsed = parseLink(ep.link || ep.link_assistir);
            return Boolean(ep.slug || parsed.slug);
          }).length, 0);
          const seriesKey = `${categoria}_${slug}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          const fila = episodiosParaDownload.flatMap((temp) =>
            (temp.episodios || []).map((ep) => {
              const parsed = parseLink(ep.link || ep.link_assistir);
              const cat = ep.categoria || parsed.categoria || categoria;
              const sl = ep.slug || parsed.slug;
              if (!sl) return null;
              const numero = Number(ep.numero) || 1;
              return {
                id: `${cat}_${sl}`,
                categoria: cat,
                slug: sl,
                titulo: `${dados.titulo || "Série"} · T${temp.numero}E${numero} · ${ep.titulo || ""}`,
                thumb: ep.imagem || thumb,
                filmeId: ep.filmeId || ep.id || sl,
                tipo: "episodio",
                serieCategoria: categoria,
                serieSlug: slug,
                metadata: {
                  season: Number(temp.numero) || 0,
                  episode: numero,
                  episodeTitle: ep.titulo || "",
                  overview: ep.sinopse || "",
                  seriesTitle: dados.titulo || "",
                  seriesKey,
                  seriesTotalEpisodes: totalEpisodios,
                  year: dados.ano || "",
                },
              };
            }).filter(Boolean),
          );
          return solicitarFilaDownloads(fila);
        }
        return solicitarDownload({
          categoria, slug, titulo: dados.titulo || "", thumb,
          filmeId, tipo: "filme",
          sinopse: dados.descricao || dados.sinopse || dados.overview || "",
          ano: dados.ano || "",
        });
      },
      onFavorite: async () => {
        const resposta = await toggleFavoritoComConfirmacao({
          filmeId, slug, categoria, titulo: dados.titulo || "Tedflix", thumb,
          tipo: isSerie ? "series" : "movie",
        });
        if (resposta?.success && !resposta.cancelled) {
          favorito = typeof resposta.favorito === "boolean" ? resposta.favorito : !favorito;
        }
        return { favorito };
      },
      after,
    }),
  );

  monitorarDownloadsNaTela(page);
  return page;
}
