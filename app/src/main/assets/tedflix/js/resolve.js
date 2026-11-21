/**
 * resolve.js — resolve título/favorito usando a pesquisa unificada do Content Server.
 */
import { buscar, ehSerie, parseLink } from "./server-api.js";

function scoreTitulo(itemTitulo, nome) {
  const t = String(itemTitulo || "").toLowerCase().replace(/[^a-z0-9]+/gi, "");
  const n = String(nome || "").toLowerCase().replace(/[^a-z0-9]+/gi, "");
  if (!t || !n) return 0;
  if (t === n) return 3;
  if (t.includes(n) || n.includes(t)) return 2;
  return 0;
}

export async function resolveTituloParaRota({ titulo, preferSerie = false } = {}) {
  const t = String(titulo || "").trim();
  if (!t) return null;


  try {
    const busca = await buscar(t);
    const resultados = Array.isArray(busca?.resultados) ? busca.resultados : [];
    const hit =
      resultados.find((r) => scoreTitulo(r.titulo, t) >= 2) || resultados[0];
    if (hit) {
      const partes = parseLink(hit.link_assistir || hit.link_detalhe || "");
      const cat = hit.categoria || partes.categoria;
      const slug = hit.slug || partes.slug;
      if (cat && slug) {
        const tipo = ehSerie(hit) ? "serie" : "filme";
        return `#/titulo/${tipo}/${encodeURIComponent(cat)}/${encodeURIComponent(slug)}`;
      }
    }
  } catch (_) {}

  return null;
}

export async function resolveEpisodioPorTitulo({ titulo, temp = 1, ep = 1 } = {}) {
  const t = String(titulo || "").trim();
  if (!t) return null;
  try {
    const busca = await buscar(t);
    const resultados = Array.isArray(busca?.resultados) ? busca.resultados : [];
    const series = resultados.filter((item) => /serie|séri|tv/i.test(String(item.tipo || item.media_type || "")));
    const hit = series.find((item) => scoreTitulo(item.titulo || item.title, t) >= 2) || series[0];
    const parts = parseLink(hit?.link_assistir || hit?.link_detalhe || "");
    const category = String(hit?.categoria || parts.categoria || "").toLowerCase();
    const sourceId = String(hit?.sourceId || hit?.source_id || hit?.slug || parts.slug || "").trim();
    if (hit && /^v[1-5]$/.test(category) && sourceId) {
      const season = Math.max(1, Number(temp) || 1);
      const episode = Math.max(1, Number(ep) || 1);
      const episodeSlug = `serie-${sourceId}-${season}-${episode}`;
      const query = new URLSearchParams({
        t: String(season), e: String(episode),
        serieCategoria: category, serieSlug: sourceId,
        filmeId: `${category}:${sourceId}:s${season}e${episode}`,
        titulo: hit.titulo || hit.title || t,
      });
      return `#/episodio/${encodeURIComponent(category)}/${encodeURIComponent(episodeSlug)}?${query}`;
    }
  } catch (_) {}

  return null;
}
