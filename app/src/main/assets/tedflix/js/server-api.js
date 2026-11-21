/**
 * Cliente único do TEDFLIX Content Server v2.
 * Contrato utilizado: /api/search, /api/catalog/*, /api/categories,
 * /api/content/:api/:sourceId e /api/play/:api/:sourceId.
 * O aplicativo não chama rotas específicas antigas de providers nem o TMDB diretamente.
 */
import { CONTENT_API_BASE } from "./config.js";

const BASE = String(CONTENT_API_BASE || "https://api.tedflix.site").replace(/\/$/, "");
const CACHE_PREFIX = "tedflix:content-server:v2:";
const memory = new Map();
const inflight = new Map();
const TTL_SEARCH = 45 * 1000;
const TTL_CATALOG = 8 * 60 * 1000;
const TTL_DETAIL = 12 * 60 * 1000;
const TTL_CATEGORIES = 30 * 60 * 1000;

function readPersistent(key) {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || "null");
    return value && Number(value.t) && value.v !== undefined ? value : null;
  } catch (_) { return null; }
}
function writePersistent(key, value) {
  try {
    const raw = JSON.stringify({ t: Date.now(), v: value });
    if (raw.length <= 1_500_000) localStorage.setItem(CACHE_PREFIX + key, raw);
  } catch (_) {}
}
function errorMessage(body, status) {
  return body?.error?.message || body?.message || `Falha na API de conteúdo (HTTP ${status}).`;
}
function assertSuccess(body) {
  // Só rejeita quando o servidor marca success=false explicitamente
  if (body && body.success === false) throw new Error(errorMessage(body, body.status || ""));
}
async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function")
      ? AbortSignal.timeout(options.timeout || 20000) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  assertSuccess(body);
  return body;
}
async function requestJSON(path, ttl = TTL_CATALOG, options = {}) {
  const url = `${BASE}${path}`;
  // Resolução de vídeo nunca pode vir de cache: URLs podem expirar e headers são específicos.
  if (options.noCache) return fetchJSON(url, options);
  const key = path;
  const now = Date.now();
  const cached = memory.get(key) || readPersistent(key);
  if (cached && cached.v !== undefined) {
    memory.set(key, cached);
    if (now - cached.t < ttl) return cached.v;
    if (!inflight.has(key)) {
      const refresh = fetchJSON(url, options).then((body) => {
        const value = { t: Date.now(), v: body };
        memory.set(key, value);
        writePersistent(key, body);
        return body;
      }).catch(() => cached.v).finally(() => inflight.delete(key));
      inflight.set(key, refresh);
    }
    return cached.v;
  }
  if (inflight.has(key)) return inflight.get(key);
  const task = fetchJSON(url, options).then((body) => {
    const value = { t: Date.now(), v: body };
    memory.set(key, value);
    writePersistent(key, body);
    return body;
  }).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

export function limparCacheCatalogo() {
  memory.clear();
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch (_) {}
}
export function limparTitulo(value) {
  const text = String(value || "").trim().replace(/^Assistir\s+/i, "").replace(/\s+Online(?: Grátis)?\s*$/i, "");
  if (text.length > 1 && text.length % 2 === 0 && text.slice(0, text.length / 2) === text.slice(text.length / 2)) return text.slice(0, text.length / 2);
  return text;
}
export function ehSerie(item) {
  return /series?|séries?|tv/i.test(String(item?.tipo || item?.type || item?.media_type || ""));
}
export function parseLink(link) {
  if (!link) return { categoria: "", slug: "" };
  const match = String(link).match(/^#\/titulo\/(filme|serie)\/([^/?]+)\/([^?]+)/i);
  if (match) return { categoria: decodeURIComponent(match[2]), slug: decodeURIComponent(match[3]) };
  const parts = String(link).replace(/^https?:\/\/[^/]+/i, "").split("/").filter(Boolean);
  return { categoria: parts[parts.length - 2] || "", slug: parts[parts.length - 1] || "" };
}
function cleanId(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    try { const path = new URL(raw).pathname.split("/").filter(Boolean); return decodeURIComponent(path[path.length - 1] || raw); }
    catch (_) {}
  }
  return raw.replace(/^\//, "");
}
function genresOf(value) {
  return (Array.isArray(value) ? value : []).map((g) => {
    if (typeof g === "string") return { id: g.toLowerCase().replace(/\s+/g, "-"), name: g };
    return { ...g, name: g?.name || g?.label || g?.id || "" };
  }).filter((g) => g.name);
}
function routeFor(row, api, sourceId, sourceSlug, isSeries) {
  const query = sourceSlug && sourceSlug !== sourceId ? `?sourceSlug=${encodeURIComponent(sourceSlug)}` : "";
  return `#/titulo/${isSeries ? "serie" : "filme"}/${encodeURIComponent(api)}/${encodeURIComponent(sourceId)}${query}`;
}
export function normalizarItemServidor(row = {}) {
  const api = String(row.api || row.provider || "").toLowerCase();
  const sourceId = cleanId(row.sourceId ?? row.id ?? row.source_id ?? row.slug ?? "");
  const sourceSlug = cleanId(row.sourceSlug ?? row.slug ?? sourceId);
  const isSeries = String(row.type || row.tipo || "").toLowerCase() === "series" || ehSerie(row);
  const type = isSeries ? "Série" : "Filme";
  const rawTitle = row.title || row.titulo || row.name || sourceSlug || sourceId;
  const title = limparTitulo(/^\d+$/.test(String(rawTitle || "").trim()) ? (sourceSlug && !/^\d+$/.test(sourceSlug) ? sourceSlug : "Título não identificado") : rawTitle);
  const poster = row.poster || row.imagem || row.capa || row.thumb || "";
  const backdrop = row.backdrop || row.banner || poster;
  const link = api && sourceId ? routeFor(row, api, sourceId, sourceSlug, isSeries) : "#/";
  return {
    ...row,
    id: `${api}:${sourceId}`,
    filmeId: sourceId,
    api,
    fonte: api,
    source: api,
    sourceId,
    sourceSlug,
    source_id: sourceId,
    source_slug: sourceSlug,
    categoria: api,
    // `slug` representa o identificador de origem usado nas novas rotas /api/content e /api/play.
    slug: sourceId,
    titulo: title,
    nome: title,
    tipo: type,
    imagem: poster,
    capa: poster,
    thumb: poster,
    banner: backdrop,
    poster,
    backdrop,
    ano: row.year ?? row.ano ?? null,
    nota: row.rating ?? row.nota ?? null,
    sinopse: row.overview || row.description || row.sinopse || "",
    descricao: row.overview || row.description || row.sinopse || "",
    generos: genresOf(row.genres || row.generos),
    tmdb_id: row.tmdbId || row.tmdb_id || null,
    imdb_id: row.imdbId || row.imdb_id || null,
    pode_assistir: row.playable !== false || Boolean(row.tmdbId || row.tmdb_id),
    link_assistir: link,
    link_detalhe: link,
  };
}

export function rotaDetalhe(item) {
  if (!item) return "#/";
  const api = String(item.api || item.fonte || item.categoria || "").toLowerCase();
  const sourceId = cleanId(item.sourceId || item.source_id || item.filmeId || item.slug || item.id);
  const sourceSlug = cleanId(item.sourceSlug || item.source_slug || "");
  const isSeries = ehSerie(item);
  try {
    sessionStorage.setItem("tedflix:lastCard", JSON.stringify({
      api, slug: sourceId, sourceId, sourceSlug, filmeId: sourceId,
      titulo: item.titulo || item.title || "", ano: item.ano || item.year || "",
      poster: item.poster || item.imagem || item.capa || "",
      imagem: item.imagem || item.poster || "", sinopse: item.sinopse || item.overview || "", tipo: item.tipo || item.type || "",
    }));
  } catch (_) {}
  if ((api === "tedtop" || api === "v6" || String(item.categoria || "").toLowerCase() === "destaque") && sourceId) {
    return `#/titulo/filme/destaque/${encodeURIComponent(sourceSlug || sourceId)}`;
  }
  if (!/^v[1-5]$/.test(api) || !sourceId) return "#/";
  return routeFor(item, api, sourceId, sourceSlug, isSeries);
}

function resultsFrom(payload) {
  return Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.items) ? payload.items : [];
}
function settledSources(payload) {
  const map = {};
  for (const source of payload?.sources || []) map[source.api] = { ok: !!source.ok, ms: source.ms || 0, error: source.error || null };
  return map;
}
export async function buscarUnificada(query, page = 1, limit = 40) {
  const q = String(query || "").trim();
  if (q.length < 2) return { resultados: [], fontes: {}, parcial: false, todasIndisponiveis: false };
  const payload = await requestJSON(`/api/search?q=${encodeURIComponent(q)}&type=all&page=${Math.max(1, Number(page) || 1)}`, TTL_SEARCH, { timeout: 30000 });
  const resultados = resultsFrom(payload).slice(0, Math.max(1, Number(limit) || 40)).map(normalizarItemServidor);
  const fontes = settledSources(payload);
  const sourceList = payload.sources || [];
  return { ...payload, resultados, fontes, parcial: sourceList.some((s) => !s.ok) && resultados.length > 0, todasIndisponiveis: sourceList.length > 0 && sourceList.every((s) => !s.ok) };
}
export async function buscar(query, page = 1, limit = 40) {
  try {
    const g = await buscarGlobal(query);
    if (g.resultados && g.resultados.length) return g;
  } catch (_) {}
  return buscarUnificada(query, page, limit);
}

async function catalog(path, timeout = 30000) {
  const payload = await requestJSON(path, TTL_CATALOG, { timeout });
  return resultsFrom(payload).map(normalizarItemServidor);
}

/** Remove pôsteres quebrados (URL sem path de imagem). */
function posterOk(url) {
  const u = String(url || "");
  if (!u || u.length < 12) return false;
  if (/\/(resize\/)?\?w=\d/.test(u)) return false; // megaflix/?w=282
  if (/^https?:\/\/[^/]+\/?\?/.test(u)) return false;
  return true;
}

/** Dedup por título normalizado, intercalando providers (v1…v5). */
export function diversificarLista(items = [], { limite = 40 } = {}) {
  const buckets = { v1: [], v2: [], v3: [], v4: [], v5: [], other: [] };
  for (const raw of items || []) {
    const item = raw?.api ? raw : normalizarItemServidor(raw);
    if (!item) continue;
    if (!posterOk(item.poster || item.imagem || item.capa)) {
      item.poster = item.poster || "";
      item.imagem = item.imagem || item.poster;
      // mantém item sem capa — UI mostra placeholder
    }
    const api = String(item.api || item.categoria || "other").toLowerCase();
    (buckets[api] || buckets.other).push(item);
  }
  const order = ["v5", "v4", "v3", "v1", "v2", "other"]; // prioriza fontes distintas
  const seen = new Set();
  const out = [];
  let guard = 0;
  while (out.length < limite && guard < limite * 6) {
    guard++;
    let added = false;
    for (const key of order) {
      const list = buckets[key];
      while (list.length) {
        const item = list.shift();
        const norm = String(item.titulo || item.title || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        out.push(item);
        added = true;
        break;
      }
    }
    if (!added) break;
  }
  return out;
}

export async function getFilmesDiversos(page = 1) {
  const items = await getFilmes(page);
  return diversificarLista(items, { limite: 48 });
}
export async function getSeriesDiversas(page = 1) {
  const items = await getSeries(page);
  return diversificarLista(items, { limite: 48 });
}
export async function getFilmesPorFonte(api, page = 1) {
  // Catálogo global já mistura; filtramos o que veio da fonte
  const items = await getFilmes(page);
  return (items || []).filter((x) => String(x.api || x.categoria) === api);
}

export async function getFilmes(page = 1) {
  const p = Math.max(1, Number(page) || 1);
  try {
    const payload = await requestJSON(`/filmes?page=${p}&limit=100`, TTL_CATALOG, { timeout: 90000 });
    const list = Array.isArray(payload?.data) ? payload.data : resultsFrom(payload);
    if (list.length) return list.map(normalizarProviderItem).filter(Boolean);
  } catch (_) {}
  try {
    const items = await catalog(`/api/catalog/movies?page=${p}`);
    return diversificarLista(items, { limite: 100 });
  } catch (_) {
    return [];
  }
}
export async function getSeries(page = 1) {
  const p = Math.max(1, Number(page) || 1);
  try {
    const payload = await requestJSON(`/series?page=${p}&limit=100`, TTL_CATALOG, { timeout: 90000 });
    const list = Array.isArray(payload?.data) ? payload.data : resultsFrom(payload);
    if (list.length) return list.map(normalizarProviderItem).filter(Boolean);
  } catch (_) {}
  try {
    const items = await catalog(`/api/catalog/series?page=${p}`);
    return diversificarLista(items, { limite: 100 });
  } catch (_) {
    return [];
  }
}

/** Agenda de lançamentos de episódios do MegaCine, já enriquecida pelo TMDB no servidor. */
export async function getAgenda(days = 14, force = false) {
  const safeDays = Math.min(60, Math.max(1, Number(days) || 14));
  const path = `/api/agenda?days=${safeDays}${force ? `&_=${Date.now()}` : ""}`;
  return requestJSON(path, 5 * 60 * 1000, { timeout: 35000, noCache: !!force });
}
export async function getUltimosFilmes() {
  const items = diversificarLista(await getFilmes(1), { limite: 30 });
  return items.sort((a, b) => Number(b.ano || 0) - Number(a.ano || 0)).slice(0, 36);
}
export async function getLancamentos() {
  try {
    const a = await getLancamentosProvider();
    if (a && a.length) return a;
  } catch (_) {}
  return getUltimosFilmes();
}
export async function getCarousel() {
  const [movies, series] = await Promise.all([getFilmes(1), getSeries(1)]);
  return diversificarLista([...(movies || []), ...(series || [])], { limite: 12 })
    .filter((item) => item.imagem || item.poster || item.banner)
    .slice(0, 8)
    .map((item) => ({ ...item, banner: item.backdrop || item.imagem || item.poster }));
}
export const getGenero = (slug, page = 1) => getGeneroUnificado(slug, page);
export async function getCategoriasServidor() {
  // Provider v3: /categorias  | legado: /api/categories
  try {
    const payload = await requestJSON("/categorias", TTL_CATEGORIES);
    const list = Array.isArray(payload.categories) ? payload.categories
      : Array.isArray(payload.data) ? payload.data : [];
    if (list.length) {
      return list.map((category) => ({
        ...category,
        slug: category.sourceSlug || category.slug || category.id,
        label: category.name || category.label || category.id,
        availableIn: Array.isArray(category.availableIn) ? category.availableIn : [],
      }));
    }
  } catch (_) {}
  try {
    const payload = await requestJSON("/api/categories", TTL_CATEGORIES);
    return (Array.isArray(payload.categories) ? payload.categories : []).map((category) => ({
      ...category,
      slug: category.sourceSlug || category.slug || category.id,
      label: category.name || category.label || category.id,
      availableIn: Array.isArray(category.availableIn) ? category.availableIn : [],
    }));
  } catch (_) {}
  // Fallback estático (config do app) — evita tela vazia
  try {
    const { CATEGORIAS } = await import("./config.js");
    return (CATEGORIAS || []).map((c) => ({
      slug: c.slug,
      id: c.slug,
      label: c.label,
      name: c.label,
      availableIn: [],
    }));
  } catch (_) {
    return [];
  }
}
export async function getGeneroUnificado(slug, page = 1) {
  const wanted = String(slug || "").trim();
  if (!wanted) return [];
  // Provider v3 — categoria com paginação
  try {
    const fixed = await getCategoriaFixa(wanted, page);
    if (Array.isArray(fixed) && fixed.length) return fixed;
  } catch (_) {}
  const category = (await getCategoriasServidor().catch(() => [])).find((item) =>
    [item.id, item.slug, item.sourceSlug, item.name, item.label].some((value) => String(value || "").toLowerCase() === wanted.toLowerCase())
  );
  const key = category?.sourceSlug || category?.slug || category?.id || wanted;
  const p = Math.max(1, Number(page) || 1);
  const [movies, series] = await Promise.all([
    catalog(`/api/catalog/movies?page=${p}&category=${encodeURIComponent(key)}`).catch(() => []),
    catalog(`/api/catalog/series?page=${p}&category=${encodeURIComponent(key)}`).catch(() => []),
  ]);
  const unique = new Map();
  [...movies, ...series].forEach((item) => unique.set(`${item.api}:${item.sourceId}`, item));
  return [...unique.values()];
}

function typeEndpoint(type) { return /serie|sér|tv|episode|epis[oó]dio/i.test(String(type || "")) ? "series" : "movie"; }
function lastCardHint(api, sourceId) {
  try {
    const card = JSON.parse(sessionStorage.getItem("tedflix:lastCard") || "null");
    if (card && card.api === api && String(card.sourceId || card.slug || "") === String(sourceId)) return card;
  } catch (_) {}
  return null;
}
function detailPath(api, type, sourceId, sourceSlug = "", hint = {}) {
  const params = new URLSearchParams({ type: typeEndpoint(type) });
  if (hint?.titulo) params.set("title", hint.titulo);
  if (hint?.ano) params.set("year", String(hint.ano));
  if (sourceSlug && sourceSlug !== sourceId) params.set("sourceSlug", sourceSlug);
  return `/api/content/${encodeURIComponent(api)}/${encodeURIComponent(cleanId(sourceId))}?${params.toString()}`;
}
function normalizeSeason(raw, index) {
  const number = Number(raw?.seasonNumber ?? raw?.season_number ?? raw?.numero ?? raw?.number ?? raw?.season ?? index + 1) || index + 1;
  const episodes = Array.isArray(raw?.episodes) ? raw.episodes : Array.isArray(raw?.episodios) ? raw.episodios : [];
  return {
    ...raw,
    numero: number,
    season_number: number,
    titulo: raw?.title || raw?.name || `Temporada ${number}`,
    imagem: raw?.poster || raw?.image || "",
    episodios: episodes.map((ep, epIndex) => ({
      ...ep,
      numero: Number(ep?.episodeNumber ?? ep?.episode_number ?? ep?.numero ?? ep?.number ?? epIndex + 1) || epIndex + 1,
      titulo: ep?.title || ep?.name || ep?.titulo || `Episódio ${epIndex + 1}`,
      imagem: ep?.still || ep?.poster || ep?.image || ep?.imagem || ep?.thumb || "",
      sinopse: ep?.overview || ep?.description || ep?.sinopse || "",
      duracao: ep?.runtime || ep?.duration || ep?.duracao || null,
      tmdb_id: ep?.tmdbId || ep?.id || null,
      video_path: ep?.video_path || ep?.videoPath || null,
    })),
  };
}
export async function getTitulo(api, slug, type = "movie", sourceSlug = "") {
  const source = String(api || "").toLowerCase();
  if (!/^v[1-5]$/.test(source)) throw new Error("Fonte de conteúdo inválida.");
  const rawSlug = decodeURIComponent(String(slug || sourceSlug || "").trim());
  if (!rawSlug) throw new Error("Identificador do título ausente.");

  // Monta URL do /vN/play/*
  let playPath;
  if (/^https?:\/\//i.test(rawSlug)) {
    playPath = `/${source}/play/${encodeURIComponent(rawSlug)}`;
  } else if (rawSlug.includes("/")) {
    // path relativo da fonte
    const bases = {
      v1: "https://megacine.yachts/",
      v2: "https://megaflix.live/",
      v3: "https://megafilmeshd1.com/",
      v4: "https://topfilmes.biz/",
      v5: "https://www.seriesflixhit.com/",
    };
    const base = bases[source] || "";
    const full = rawSlug.startsWith("http") ? rawSlug : base.replace(/\/$/, "") + "/" + rawSlug.replace(/^\//, "");
    playPath = `/${source}/play/${encodeURIComponent(full)}`;
  } else {
    // id/slug simples — tenta cache e monta URL típica
    let cached = null;
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("tedflix:card:" + source + ":") && k.includes(rawSlug.slice(0, 40))) {
          cached = JSON.parse(sessionStorage.getItem(k) || "null");
          break;
        }
      }
    } catch (_) {}
    if (cached?.playUrl) {
      playPath = cached.playUrl.replace(/^https?:\/\/[^/]+/i, "");
    } else if (cached?.sourceUrl) {
      playPath = `/${source}/play/${encodeURIComponent(cached.sourceUrl)}`;
    } else {
      const bases = {
        v1: "https://megacine.yachts/",
        v2: "https://megaflix.live/",
        v3: "https://megafilmeshd1.com/",
        v4: "https://topfilmes.biz/assistir/",
        v5: "https://www.seriesflixhit.com/",
      };
      const full = (bases[source] || "") + rawSlug;
      playPath = `/${source}/play/${encodeURIComponent(full)}`;
    }
  }

  const payload = await requestJSON(playPath, TTL_DETAIL, { timeout: 40000 });
  if (payload && payload.success === false) throw new Error(payload.error || "Falha ao carregar ficha");

  const title = limparTitulo(payload.title || payload.titulo || rawSlug);
  const poster = payload.poster || payload.cover || payload.imagem || "";
  const isSeries = String(payload.type || type).toLowerCase() === "series";
  const seasonsRaw = Array.isArray(payload.seasons) ? payload.seasons : [];
  const seasons = seasonsRaw.map((season, index) => normalizeSeason(season, index));
  const watch = payload.watch || null;

  try {
    sessionStorage.setItem(
      "tedflix:lastCard",
      JSON.stringify({
        api: source,
        sourceId: rawSlug,
        sourceUrl: payload.sourceUrl || rawSlug,
        titulo: title,
        title,
        watch,
        type: isSeries ? "series" : "movie",
      })
    );
  } catch (_) {}

  return {
    ...payload,
    api: source,
    fonte: source,
    sourceId: payload.id || rawSlug,
    sourceSlug: payload.sourceUrl || rawSlug,
    id: payload.id || rawSlug,
    slug: payload.id || rawSlug,
    categoria: source,
    filmeId: payload.id || rawSlug,
    titulo: title,
    imagem: poster,
    capa: poster,
    thumb: poster,
    poster,
    backdrop: poster,
    banner: poster,
    ano: payload.year || null,
    nota: payload.rating ?? null,
    descricao: payload.overview || "",
    sinopse: payload.overview || "",
    generos: genresOf(payload.genres || []),
    tipo: isSeries ? "Série" : "Filme",
    temporadas: seasons,
    total_temporadas: seasons.length || null,
    pode_assistir: !!watch || isSeries,
    watch,
    link_assistir: watch,
    playable: true,
  };
}

export async function getPlayback(api, slug, type = "movie") {
  const source = String(api || "").toLowerCase();
  if (!/^v[1-5]$/.test(source)) throw new Error("Fonte de reprodução inválida.");

  // 1) Se lastCard tem watch pronto, usa
  let watchUrl = null;
  try {
    const card = JSON.parse(sessionStorage.getItem("tedflix:lastCard") || "null");
    if (card && String(card.api || "").toLowerCase() === source && card.watch) {
      watchUrl = card.watch;
    }
  } catch (_) {}

  // 2) Senão busca ficha e pega watch
  if (!watchUrl) {
    const detail = await getTitulo(source, slug, type);
    watchUrl = detail.watch || detail.link_assistir || null;
  }

  if (!watchUrl) throw new Error("Sem link de vídeo para este título.");

  // watch já é URL absoluta do provider: https://api.../vN/video/...
  let path;
  if (/^https?:\/\//i.test(watchUrl)) {
    path = watchUrl.replace(/^https?:\/\/[^/]+/i, "");
  } else {
    path = watchUrl.startsWith("/") ? watchUrl : `/${source}/video/${encodeURIComponent(watchUrl)}`;
  }

  // query de temporada/ep + title (fallback de stream no server)
  const episode = parseEpisodeSlug(slug);
  const qs = new URLSearchParams();
  if (episode) {
    qs.set("season", String(episode.season));
    qs.set("episode", String(episode.episode));
  }
  try {
    const card = JSON.parse(sessionStorage.getItem("tedflix:lastCard") || "null");
    if (card?.titulo || card?.title) qs.set("title", String(card.titulo || card.title).slice(0, 120));
  } catch (_) {}
  if ([...qs.keys()].length) {
    path += (path.includes("?") ? "&" : "?") + qs.toString();
  }

  const payload = await requestJSON(path, 0, { timeout: 45000, noCache: true });
  if (payload && payload.success === false) {
    throw new Error(payload.error || "Falha ao resolver vídeo");
  }
  const url = payload.url || payload.stream || payload.stream_url || "";
  if (!url) throw new Error("O servidor não retornou URL de vídeo.");
  if (/iframe/i.test(String(payload.format || "")) || /embed|player\.php/i.test(url) && !/\.m3u8|\.mp4/i.test(url)) {
    throw new Error("Fonte devolveu embed em vez de m3u8/mp4.");
  }
  let format = String(payload.format || "").toLowerCase();
  if (!format) format = /\.mp4(?:$|\?)/i.test(url) ? "mp4" : "hls";
  return {
    ...payload,
    url,
    format,
    headers: payload.headers || {},
    playback: { url, format, headers: payload.headers || {} },
  };
}

export async function getTemporadas(api, slug) {
  const detail = await getTitulo(api, slug, "series");
  return Array.isArray(detail.temporadas) ? detail.temporadas : [];
}
export async function getEpisodios(api, slug, seasonNumber) {
  const source = String(api || "").toLowerCase();
  const seriesId = cleanId(slug);
  const seasons = await getTemporadas(source, seriesId);
  const number = Number(seasonNumber) || 1;
  const season = seasons.find((item) => Number(item.numero || item.season_number) === number);
  return (season?.episodios || []).map((ep, index) => {
    const episodeNumber = Number(ep.numero) || index + 1;
    const epSlug = `serie-${seriesId}-${number}-${episodeNumber}`;
    return {
      ...ep,
      categoria: source,
      slug: epSlug,
      sourceSeriesSlug: seriesId,
      seasonNumber: number,
      episodeNumber,
      filmeId: `${source}:${seriesId}:s${number}e${episodeNumber}`,
      tipo: "episodio",
      link: `#/assistir/${encodeURIComponent(source)}/${encodeURIComponent(epSlug)}`,
      link_assistir: `#/assistir/${encodeURIComponent(source)}/${encodeURIComponent(epSlug)}`,
      video_path: ep.video_path || `/api/play/${source}/${encodeURIComponent(seriesId)}?type=series&season=${number}&episode=${episodeNumber}`,
    };
  });
}
export function extrairYoutubeId(url) {
  const text = String(url || "");
  const match = text.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([\w-]{11})/i);
  return match ? match[1] : null;
}


/** Normaliza item do provider v3 (link já aponta para /vN/play/). */
function normalizarProviderItem(raw) {
  if (!raw) return null;
  const link = String(raw.link || raw.url || raw.watch || "");
  const title = raw.title || raw.titulo || raw.name || "";
  const cover = raw.cover || raw.poster || raw.imagem || raw.capa || "";
  const type = /series|série|tv/i.test(String(raw.type || "")) ? "series" : "movie";
  let api = String(raw.api || raw.source || "").toLowerCase();
  if (!/^v[1-5]$/.test(api)) {
    const m = link.match(/\/v([1-5])\/(?:play|video)\//i);
    if (m) api = `v${m[1]}`;
    else if (/megaflix/i.test(link + (raw.source||""))) api = "v2";
    else if (/megacine/i.test(link + (raw.source||""))) api = "v1";
    else if (/megafilmeshd/i.test(link + (raw.source||""))) api = "v3";
    else if (/topfilmes/i.test(link + (raw.source||""))) api = "v4";
    else if (/seriesflix/i.test(link + (raw.source||""))) api = "v5";
  }
  // URL bruta da fonte (página do filme) embutida no /vN/play/
  let sourceUrl = link.replace(/^https?:\/\/[^/]+\/v[1-5]\/play\//i, "");
  if (sourceUrl === link && raw.sourceUrl) sourceUrl = String(raw.sourceUrl);
  // rota interna do app
  const idEnc = encodeURIComponent(sourceUrl || raw.id || title);
  const hash = `#/titulo/${type === "series" ? "serie" : "filme"}/${api}/${idEnc}`;
  try {
    // cache leve para a ficha
    sessionStorage.setItem(
      "tedflix:card:" + api + ":" + (sourceUrl || title).slice(0, 180),
      JSON.stringify({ api, sourceUrl, link, title, cover, type, watch: raw.watch || null })
    );
  } catch (_) {}
  return {
    ...raw,
    titulo: title,
    title,
    imagem: cover,
    poster: cover,
    capa: cover,
    ano: raw.year || raw.ano || null,
    tipo: type === "series" ? "Série" : "Filme",
    type,
    api,
    categoria: api,
    link_assistir: hash,
    link: hash,
    playUrl: link.startsWith("http") ? link : null,
    sourceUrl,
    slug: sourceUrl || String(raw.id || title),
    sourceId: sourceUrl || String(raw.id || title),
    playable: true,
  };
}

export async function getBanner() {
  const payload = await requestJSON("/banner", 10 * 60 * 1000, { timeout: 25000 });
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list.map(normalizarProviderItem).filter(Boolean);
}

export async function getNovos() {
  const payload = await requestJSON("/novos", 10 * 60 * 1000, { timeout: 25000 });
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list.map(normalizarProviderItem).filter(Boolean);
}

export async function getLancamentosProvider() {
  const payload = await requestJSON("/lancamentos", 10 * 60 * 1000, { timeout: 25000 });
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list.map(normalizarProviderItem).filter(Boolean);
}

// sobrescreve getLancamentos se existir uso genérico
export async function getLancamentosHome() {
  try {
    const a = await getLancamentosProvider();
    if (a.length) return a;
  } catch (_) {}
  return getFilmes(1);
}

export async function getCategoriaFixa(slug, page = 1) {
  const s = String(slug || "").trim();
  if (!s) return [];
  const p = Math.max(1, Number(page) || 1);
  const payload = await requestJSON(
    `/categoria/${encodeURIComponent(s)}?page=${p}&limit=100`,
    15 * 60 * 1000,
    { timeout: 60000 }
  );
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return list.map(normalizarProviderItem).filter(Boolean);
}

export async function buscarGlobal(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return { resultados: [], total: 0 };
  const payload = await requestJSON(`/busca?q=${encodeURIComponent(q)}`, 2 * 60 * 1000, { timeout: 25000 });
  const list = Array.isArray(payload?.data) ? payload.data : [];
  return {
    ...payload,
    resultados: list.map(normalizarProviderItem).filter(Boolean),
    total: payload?.total ?? list.length,
  };
}
