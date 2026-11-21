import { el, limpar } from "../dom.js";
import { cardTitulo, skeletonCard } from "../components/card.js";
import { buscar, parseLink } from "../server-api.js";
import { mapaProgresso, percentFromItem } from "../playback.js";

/** Extrai T1E77 / S1E77 do título. */
function parseEpDoTitulo(titulo) {
  const t = String(titulo || "");
  let m = t.match(/t\s*(\d+)\s*e\s*(\d+)/i);
  if (m) return { temp: m[1], ep: m[2] };
  m = t.match(/s\s*(\d+)\s*e\s*(\d+)/i);
  if (m) return { temp: m[1], ep: m[2] };
  return null;
}

/** Nome da série sem o sufixo T1E5 / S1E5. */
function nomeSerieDoTitulo(titulo) {
  return String(titulo || "")
    .replace(/\s*[Tt]\s*\d+\s*[Ee]\s*\d+.*$/u, "")
    .replace(/\s*[Ss]\s*\d+\s*[Ee]\s*\d+.*$/u, "")
    .replace(/\s*[-–—:]\s*$/u, "")
    .trim();
}

/**
 * Monta rota de detalhe/info. Episódios sempre vão para tela de info.
 * Nunca retorna rota que só mostra "não localizado" sem tentar resolve.
 */
function rotaFavorito(item) {
  const filmeId = String(item.filmeId || item.id || "").trim();
  const titulo = String(item.titulo || "").trim();
  const tipo = String(item.tipo || item.contentType || "").toLowerCase();
  const aliases = { megacine: "v3", cine: "v3", megafilmes: "v4", megaflix: "v1", novelasflix: "v1", content: "v1" };
  let categoria = String(item.categoria || "").trim().toLowerCase();
  let slug = String(item.slug || "").trim();
  categoria = aliases[categoria] || categoria;
  const imagem = String(item.thumb || item.imagem || "").trim();
  const epTitulo = parseEpDoTitulo(titulo);
  const isEpisode = tipo === "episodio" || tipo === "episode" || Boolean(epTitulo);
  const isSeries = /serie|séri|tv/.test(tipo);

  // Chaves antigas de MegaCine ficam apontadas para o provider v3 sem chamar rotas antigas.
  const cine = String(filmeId || slug).match(/^cine-(filme|serie)-(.+)$/i);
  if (cine) { categoria = "v3"; slug = cine[2]; }

  if (isEpisode && /^v[1-5]$/.test(categoria) && slug) {
    const q = new URLSearchParams({
      t: String(item.temporada || epTitulo?.temp || 1),
      e: String(item.episodio || epTitulo?.ep || 1),
      serieCategoria: aliases[String(item.serieCategoria || categoria).toLowerCase()] || item.serieCategoria || categoria,
      serieSlug: String(item.serieSlug || ""),
      filmeId, thumb: imagem, titulo,
    });
    return `#/episodio/${encodeURIComponent(categoria)}/${encodeURIComponent(slug)}?${q}`;
  }
  if (isEpisode && titulo) {
    const serieNome = nomeSerieDoTitulo(titulo) || titulo;
    const q = new URLSearchParams({ titulo: serieNome, t: String(item.temporada || epTitulo?.temp || 1), e: String(item.episodio || epTitulo?.ep || 1) });
    return `#/episodio/resolve?${q}`;
  }

  if (/^v[1-5]$/.test(categoria) && slug) {
    return `#/titulo/${isSeries ? "serie" : "filme"}/${categoria}/${encodeURIComponent(slug)}`;
  }
  if (categoria === "destaque" && slug) return `#/titulo/filme/destaque/${encodeURIComponent(slug)}`;

  // Favorecidos de servidores removidos são procurados de novo no catálogo atual pelo título.
  if (titulo) {
    const q = new URLSearchParams({ titulo, thumb: imagem, filmeId });
    return `#/favorito/resolve?${q}`;
  }
  return "#/favoritos";
}

export default async function paginaFavoritos(raiz) {
  const page = el("div", { class: "page page-favoritos" });
  page.append(
    el("h1", { class: "page-title pad" }, "Minha lista"),
    el("p", { class: "sub pad", style: "padding-top:0" }, "Títulos que você marcou como favorito"),
  );
  const grid = el("div", { class: "grid pad", style: "margin-top:12px" });
  for (let i = 0; i < 6; i++) grid.append(skeletonCard());
  page.append(grid);
  raiz.append(page);

  try {
    if (!window.AndroidPlayer?.getFavorites) {
      limpar(grid);
      grid.append(el("p", { class: "sub" }, "Favoritos disponíveis apenas no app."));
      return page;
    }
    const raw = JSON.parse(window.AndroidPlayer.getFavorites() || "{}");
    const lista = Array.isArray(raw.favoritos) ? raw.favoritos : Array.isArray(raw) ? raw : [];
    if (!lista.length) {
      limpar(grid);
      grid.append(
        el("div", { class: "empty-state" }, [
          el("p", { class: "sub" }, "Sua lista está vazia."),
          el("a", { class: "btn primary", href: "#/" }, "Explorar catálogo"),
        ]),
      );
      return page;
    }

    const cards = await Promise.all(
      lista.map(async (item) => {
        const titulo = String(item.titulo || "").trim();
        const filmeId = String(item.filmeId || item.id || "").trim();
        let categoria = String(item.categoria || "").trim();
        let slug = String(item.slug || "").trim();
        let imagem = String(item.thumb || item.imagem || "").trim();
        let tipo = String(item.tipo || item.contentType || "").trim() || "Filme";

        const epTitulo = parseEpDoTitulo(titulo);
        if (epTitulo) tipo = "episodio";

        // Episódio salvo apenas pelo título: localiza a série usando a busca unificada.
        let rotaSerieResolvida = "";
        if (epTitulo && !/^\d+$/.test(filmeId)) {
          const serieNome = nomeSerieDoTitulo(titulo);
          if (serieNome) {
            try {
              const res = await buscar(serieNome);
              const resultados = Array.isArray(res?.resultados) ? res.resultados : [];
              const series = resultados.filter((s) => /serie|séri|tv/i.test(String(s.tipo || s.media_type || "")));
              const nome = serieNome.toLowerCase().replace(/[^a-z0-9]+/gi, "");
              const hit = series.find((s) => {
                const t = String(s.titulo || s.title || "").toLowerCase().replace(/[^a-z0-9]+/gi, "");
                return t === nome || t.includes(nome) || nome.includes(t);
              }) || series[0];
              if (hit) {
                const parsed = parseLink(hit.link_assistir || hit.link_detalhe || "");
                categoria = hit.categoria || parsed.categoria || categoria;
                const sourceSeriesId = String(hit.sourceId || hit.source_id || hit.slug || parsed.slug || "").trim();
                slug = sourceSeriesId ? `serie-${sourceSeriesId}-${epTitulo.temp}-${epTitulo.ep}` : slug;
                imagem = imagem || hit.imagem || hit.capa || hit.thumb || "";
                if (/^v[1-5]$/.test(String(categoria).toLowerCase()) && sourceSeriesId) {
                  const q = new URLSearchParams({
                    t: String(epTitulo.temp), e: String(epTitulo.ep),
                    serieCategoria: String(categoria).toLowerCase(), serieSlug: sourceSeriesId,
                    filmeId: `${String(categoria).toLowerCase()}:${sourceSeriesId}:s${epTitulo.temp}e${epTitulo.ep}`,
                    thumb: imagem, titulo: serieNome,
                  });
                  rotaSerieResolvida = `#/episodio/${encodeURIComponent(String(categoria).toLowerCase())}/${encodeURIComponent(slug)}?${q}`;
                }
              }
            } catch (_) {}
          }
        }

        if ((!categoria || !slug) && titulo) {
          try {
            // 1) CONTENT
            const busca = await buscar(titulo);
            const resultados = Array.isArray(busca?.resultados) ? busca.resultados : [];
            const nome = titulo.toLowerCase();
            const hit =
              resultados.find((r) => {
                const id = String(r.filmeId || r.id || "").trim();
                const rt = String(r.titulo || "").toLowerCase();
                return (filmeId && id === filmeId) || rt === nome || rt.includes(nome) || nome.includes(rt);
              }) || resultados[0];
            if (hit) {
              const p = parseLink(hit.link_assistir);
              if (!categoria) categoria = hit.categoria || p.categoria || "";
              if (!slug) slug = hit.slug || p.slug || "";
              if (!imagem) imagem = hit.imagem || hit.capa || hit.thumb || "";
              if (!tipo || tipo === "Filme") tipo = hit.tipo || tipo;
            }
          } catch (_) {}
        }

        const base = {
          titulo,
          filmeId,
          categoria,
          slug,
          imagem,
          thumb: imagem,
          tipo,
          contentType: tipo,
          temporada: item.temporada || epTitulo?.temp,
          episodio: item.episodio || epTitulo?.ep,
          serieCategoria: item.serieCategoria,
          serieSlug: item.serieSlug,
          isEpisode: Boolean(epTitulo || /episodio|episode/i.test(tipo)),
        };
        const href = rotaSerieResolvida || rotaFavorito(base);
        return {
          ...base,
          link_detalhe: href,
          link_assistir: href,
        };
      }),
    );

    const progressoMap = mapaProgresso();

    cards.forEach((c) => {
      const keys = [
        `${c.categoria || ""}:${c.slug || c.filmeId || ""}`.toLowerCase(),
        String(c.filmeId || "").toLowerCase(),
        String(c.slug || "").toLowerCase(),
        String(c.titulo || "").trim().toLowerCase(),
      ];
      let p = 0;
      for (const k of keys) if (progressoMap[k]) { p = progressoMap[k]; break; }
      if (p > 0) {
        c.progresso = p;
        c.continuarTexto = `${p}% assistido`;
      }
    });

    limpar(grid);
    const frag = document.createDocumentFragment();
    cards.forEach((c) => frag.append(cardTitulo(c, { size: "md", eager: true })));
    grid.append(frag);
  } catch (e) {
    limpar(grid);
    grid.append(el("p", { class: "sub" }, "Não foi possível carregar os favoritos."));
  }

  return page;
}
