/**
 * APIs auxiliares que não pertencem ao Content Server v2.
 * Filmes e séries dos cinco providers são atendidos exclusivamente por server-api.js.
 * Mantemos apenas os serviços independentes TEDTOP v6 e Pluto TV.
 */
import { TEDTOP_API_BASE, PLUTO_API_BASE } from "./config.js";

const TEDTOP_BASE = String(TEDTOP_API_BASE || "https://v6-tedtop.onrender.com").replace(/\/$/, "");
const PLUTO_BASE = String(PLUTO_API_BASE || "https://pluto.tedflix.site").replace(/\/$/, "");
const cache = new Map();
const inflight = new Map();

async function getJSON(base, path, ttl = 60_000) {
  const key = `${base}${path}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < ttl) return cached.value;
  if (inflight.has(key)) return inflight.get(key);
  const request = fetch(key, { headers: { Accept: "application/json" } })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
      if (data?.success === false || data?.erro || data?.error) {
        throw new Error(data?.message || data?.error || "Serviço indisponível.");
      }
      cache.set(key, { time: Date.now(), value: data });
      return data;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

function normalizeImage(value) {
  const url = String(value || "").trim();
  return url.startsWith("//") ? `https:${url}` : url;
}

export function normalizarTedtopItem(item = {}) {
  const slug = String(item.slug || item.slug_filme || "").trim();
  const imagem = normalizeImage(item.imagem || item.thumb || item.poster || item.capa || "");
  const generos = Array.isArray(item.generos)
    ? item.generos.map((g) => typeof g === "string" ? g : g?.nome || g?.name || "").filter(Boolean)
    : (item.genero || item.genero_nome ? [item.genero || item.genero_nome] : []);
  const titulo = String(item.titulo || item.nome || slug).trim();
  return {
    ...item,
    slug,
    titulo,
    categoria: "destaque",
    api: "tedtop",
    fonte: "tedtop",
    origem: "tedtop",
    imagem,
    capa: imagem,
    poster: imagem,
    banner: normalizeImage(item.banner || item.backdrop || imagem),
    ano: item.ano || item.year || "",
    nota: item.nota ?? item.rating ?? null,
    generos,
    sinopse: item.sinopse || item.descricao || item.overview || "",
    tipo: item.tipo || item.media_type || "Filme",
    link_assistir: slug ? `#/titulo/filme/destaque/${encodeURIComponent(slug)}` : "#/",
    link_detalhe: slug ? `#/titulo/filme/destaque/${encodeURIComponent(slug)}` : "#/",
  };
}

function listaTedtop(data) {
  const raw = Array.isArray(data) ? data
    : data?.filmes || data?.bilheteria || data?.destaques || data?.resultados || data?.itens
      || data?.data?.filmes || data?.data?.itens || data?.data || [];
  return (Array.isArray(raw) ? raw : []).map(normalizarTedtopItem).filter((x) => x.slug && x.titulo);
}

function paginaTedtop(data, requested, itens) {
  const p = data?.pagination || data?.paginacao || data?.meta || {};
  const pagina = Number(data?.pagina || data?.pagina_atual || data?.page || data?.current_page || p.current_page || p.pagina_atual || requested) || requested;
  const total = Number(data?.total || data?.total_filmes || data?.total_itens || data?.count || p.total || 0) || undefined;
  const paginas = Number(data?.total_paginas || data?.totalPaginas || data?.total_pages || data?.pages || data?.ultima_pagina || p.total_pages || p.total_paginas || p.last_page || 0) || undefined;
  const flag = data?.tem_mais ?? data?.has_more ?? data?.hasMore ?? data?.proxima_pagina ?? data?.next_page ?? p.has_more ?? p.tem_mais;
  const temMais = typeof flag === "boolean" ? flag
    : typeof flag === "number" ? flag > pagina
      : paginas ? pagina < paginas
        : total ? pagina * (Number(data?.limit || data?.per_page || data?.por_pagina) || 20) < total
          : itens.length > 0;
  return { pagina, total, totalPaginas: paginas, temMais };
}

export async function getTedtopTelao(pagina = 1) {
  const n = Math.max(1, Number(pagina) || 1);
  const data = await getJSON(TEDTOP_BASE, `/telao?pagina=${n}`, 3 * 60 * 1000);
  const itens = listaTedtop(data);
  return { ...paginaTedtop(data, n, itens), itens };
}
export async function getTedtopBilheteria() {
  return listaTedtop(await getJSON(TEDTOP_BASE, "/bilheteria", 3 * 60 * 1000));
}
export async function getTedtopPorAno(ano, pagina = 1) {
  const n = Math.max(1, Number(pagina) || 1);
  const data = await getJSON(TEDTOP_BASE, `/sessao/ano/${encodeURIComponent(ano)}?pagina=${n}`, 3 * 60 * 1000);
  const itens = listaTedtop(data);
  return { ano: data?.ano || ano, ...paginaTedtop(data, n, itens), itens };
}
export async function getTedtopPorLetra(letra, pagina = 1) {
  const l = String(letra || "A").toUpperCase().slice(0, 1);
  const n = Math.max(1, Number(pagina) || 1);
  const data = await getJSON(TEDTOP_BASE, `/alfabeto/${encodeURIComponent(l)}?pagina=${n}`, 3 * 60 * 1000);
  const itens = listaTedtop(data);
  return { letra: data?.letra || l, ...paginaTedtop(data, n, itens), itens };
}
export async function getTedtopPorGenero(genero, pagina = 1) {
  const data = await getTedtopTelao(pagina);
  const key = String(genero || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const itens = data.itens.filter((item) => item.generos.some((g) => String(g).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-") === key));
  return { genero, pagina: data.pagina, total: itens.length, temMais: data.temMais, itens };
}
export async function getTedtopFilme(slug) {
  const id = String(slug || "").trim();
  if (!id) return null;
  try { return normalizarTedtopItem(await getJSON(TEDTOP_BASE, `/filme/${encodeURIComponent(id)}`, 10 * 60 * 1000)); }
  catch (_) { return null; }
}
export async function getTedtopIngresso(slug) {
  const id = String(slug || "").trim();
  if (!id) return null;
  try {
    const response = await fetch(`${TEDTOP_BASE}/ingresso/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return response.ok && !data?.error && !data?.erro && typeof data?.direct_url === "string" && data.direct_url.trim() ? data : null;
  } catch (_) { return null; }
}

// Pluto TV possui API própria e não passa pelo Content Server de filmes/séries.
export const getPlutoHome = () => getJSON(PLUTO_BASE, "/v1/home", 3 * 60 * 1000);
export const getPlutoCategories = () => getJSON(PLUTO_BASE, "/v1/categories", 5 * 60 * 1000);
export const getPlutoCategory = (slug) => getJSON(PLUTO_BASE, `/v1/categories/${encodeURIComponent(slug)}`, 3 * 60 * 1000);
export const getPlutoChannels = () => getJSON(PLUTO_BASE, "/v1/channels", 3 * 60 * 1000);
export const getPlutoStream = (id) => getJSON(PLUTO_BASE, `/v1/live/${encodeURIComponent(id)}`, 60 * 1000);
export const getPlutoVod = () => getJSON(PLUTO_BASE, "/v1/vod", 5 * 60 * 1000);
export const getPlutoVodStream = (slug) => getJSON(PLUTO_BASE, `/v1/vod/${encodeURIComponent(slug)}/stream`, 60 * 1000);
