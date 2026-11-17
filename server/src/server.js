'use strict';

require('dotenv').config();
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const pLimit = require('p-limit');
const providersDefault = require('./providers');
const { error } = require('./lib/normalize');
const { stats: cacheStats } = require('./lib/cache');
const { createContentService, normalizeType } = require('./services/content.service');
const { handleProxy } = require('./legacy-stream/proxy');
const tmdbService = require('./services/tmdb.service');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const SEARCH_TIMEOUT = Number(process.env.SEARCH_TIMEOUT_MS) || 12000;

const CATALOG_MAX_PAGES = Math.max(1, Number(process.env.CATALOG_MAX_PAGES) || 500);
const CATALOG_ALL_CONCURRENCY = Math.max(1, Number(process.env.CATALOG_ALL_CONCURRENCY) || 4);
const CATALOG_ALL_TTL_MS = Math.max(60_000, Number(process.env.CATALOG_ALL_TTL_MS) || 20 * 60 * 1000);
const catalogAllCache = new Map(); // key -> { expires, payload }

function catalogFetchPage(provider, api, type, page, category) {
  if (api === 'v1' || api === 'v2' || api === 'v3') {
    return provider.catalog(type === 'series' ? 'series' : 'movies', page, category);
  }
  if (api === 'v4' && type === 'movie' && typeof provider.catalog === 'function') {
    return provider.catalog(page, category);
  }
  if (api === 'v5' && type === 'movie') return provider.catalog(page, category);
  return { results: [] };
}

async function catalogAllForProvider(providers, api, type, category, maxPages) {
  const provider = providers.get(api);
  if (!provider?.catalog && !(api === 'v4' && provider)) {
    return { api, ok: false, pagesFetched: 0, totalPages: null, results: [], error: 'no catalog' };
  }
  const begin = Date.now();
  const all = [];
  const seen = new Set();
  let pagesFetched = 0;
  let totalPages = null;
  let lastError = null;

  // 1ª página define totalPages quando disponível
  try {
    const first = await withTimeout(() => catalogFetchPage(provider, api, type, 1, category), SEARCH_TIMEOUT, api);
    pagesFetched = 1;
    for (const item of first?.results || []) {
      const key = String(item.id || item.sourceId || item.sourceSlug || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push(item);
    }
    totalPages = first?.pagination?.totalPages || null;
    const hasNextFirst = first?.pagination?.hasNext;
    if ((totalPages != null && totalPages <= 1) || hasNextFirst === false || !(first?.results || []).length) {
      return { api, ok: true, ms: Date.now() - begin, pagesFetched, totalPages: totalPages || 1, results: all, error: null };
    }
  } catch (e) {
    return { api, ok: false, ms: Date.now() - begin, pagesFetched: 0, totalPages: null, results: [], error: e.message || String(e) };
  }

  const lastPage = Math.min(maxPages, totalPages || maxPages);
  const pending = [];
  for (let page = 2; page <= lastPage; page++) pending.push(page);

  const limit = pLimit(CATALOG_ALL_CONCURRENCY);
  let emptyStreak = 0;
  // Processa em lotes para poder parar cedo se esgotar
  while (pending.length && emptyStreak < 2) {
    const batch = pending.splice(0, CATALOG_ALL_CONCURRENCY * 2);
    const settled = await Promise.all(batch.map((page) => limit(async () => {
      try {
        const data = await withTimeout(() => catalogFetchPage(provider, api, type, page, category), SEARCH_TIMEOUT, api);
        return { page, ok: true, results: data?.results || [], pagination: data?.pagination || null };
      } catch (e) {
        return { page, ok: false, results: [], error: e.message || String(e) };
      }
    })));
    settled.sort((a, b) => a.page - b.page);
    for (const row of settled) {
      pagesFetched++;
      if (!row.ok) {
        lastError = row.error;
        emptyStreak++;
        continue;
      }
      if (row.pagination?.totalPages) totalPages = Math.max(totalPages || 0, row.pagination.totalPages);
      if (!row.results.length) {
        emptyStreak++;
        // Se totalPages conhecido, continua; senão para
        if (totalPages == null) {
          pending.length = 0;
          break;
        }
        continue;
      }
      emptyStreak = 0;
      for (const item of row.results) {
        const key = String(item.id || item.sourceId || item.sourceSlug || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        all.push(item);
      }
      if (row.pagination?.hasNext === false && totalPages == null) {
        pending.length = 0;
        break;
      }
    }
  }

  return {
    api,
    ok: true,
    ms: Date.now() - begin,
    pagesFetched,
    totalPages: totalPages || pagesFetched,
    results: all,
    error: lastError,
  };
}



function withTimeout(task, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createApp(options = {}) {
  const providers = options.providers || providersDefault;
  const content = createContentService({ providers, tmdb: options.tmdb });
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true });
  app.register(cors, { origin: true });
  const started = Date.now();

  app.get('/v2/proxy', async (req, reply) => {
    reply.hijack();
    handleProxy(req.raw, reply.raw, new URL(req.raw.url, `http://${req.headers.host || 'localhost'}`));
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'tedflix-content',
    version: '2.0.0',
    uptime: Math.floor((Date.now() - started) / 1000),
  }));

  app.get('/api/health', async () => ({
    ok: true,
    version: '2.0.0',
    uptime: Math.floor((Date.now() - started) / 1000),
    sources: providers.list().map((source) => ({ api: source.api, name: source.name })),
    cache: cacheStats(),
  }));

  app.get('/api/sources', async () => ({ success: true, sources: providers.list() }));

  app.get('/api/sources/:api', async (req, reply) => {
    const provider = providers.get(req.params.api);
    if (!provider) return reply.code(404).send(error(req.params.api, 'SOURCE_NOT_FOUND', 'Provider desconhecido'));
    const info = provider.capabilities ? provider.capabilities() : {};
    return { success: true, api: req.params.api, name: providers.list().find((s) => s.api === req.params.api)?.name, ...info, base: provider.BASE || null };
  });

  // Pesquisa única: cada resultado preserva api + sourceId, essenciais para abrir
  // a ficha e resolver o vídeo na mesma fonte em que o card foi encontrado.
  app.get('/api/search', async (req) => {
    const q = String(req.query.q || '').trim();
    const type = normalizeType(req.query.type) || 'all';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    if (!q) return error(null, 'INVALID_PARAMETERS', 'O parâmetro q é obrigatório.');

    const limit = pLimit(5);
    const apis = ['v1', 'v2', 'v3', 'v4', 'v5'];
    const settled = await Promise.all(apis.map((api) => limit(async () => {
      const provider = providers.get(api);
      const begin = Date.now();
      try {
        const data = await withTimeout(async () => {
          if (api === 'v2' && type === 'all') {
            const [movies, series] = await Promise.all([
              provider.search(q, page, 'movie'),
              provider.search(q, page, 'series'),
            ]);
            return { api, query: q, results: [...(movies.results || []), ...(series.results || [])] };
          }
          if (api === 'v2') return provider.search(q, page, type);
          return provider.search(q, page);
        }, SEARCH_TIMEOUT, api);
        let results = Array.isArray(data?.results) ? data.results : [];
        if (type !== 'all') results = results.filter((item) => !item.type || item.type === type);
        return { api, ok: true, ms: Date.now() - begin, results, pagination: data?.pagination || null };
      } catch (e) {
        return { api, ok: false, ms: Date.now() - begin, results: [], error: e.message || String(e) };
      }
    })));

    const results = settled.flatMap((source) => source.results || []);
    return {
      success: true,
      query: q,
      type,
      page,
      sources: settled.map(({ api, ok, ms, error: message, pagination }) => ({ api, ok, ms, error: message || null, pagination })),
      results,
      total: results.length,
    };
  });

  // Catálogo único. ?page=N página; ?all=1 varre todas as páginas de cada fonte.
  app.get('/api/catalog/:type', async (req) => {
    const type = normalizeType(req.params.type);
    if (!type) return error(null, 'INVALID_PARAMETERS', 'Use /api/catalog/movies ou /api/catalog/series.');
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const category = req.query.category ? String(req.query.category) : null;
    const wantAll = ['1', 'true', 'yes', 'all'].includes(String(req.query.all || '').toLowerCase());
    const maxPages = Math.min(
      CATALOG_MAX_PAGES,
      Math.max(1, Number.parseInt(req.query.maxPages, 10) || CATALOG_MAX_PAGES)
    );
    const apis = type === 'movie' ? ['v1', 'v2', 'v3', 'v4', 'v5'] : ['v1', 'v2', 'v3'];

    if (wantAll) {
      const cacheKey = `all:${type}:${category || 'all'}:${maxPages}`;
      const cached = catalogAllCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return { ...cached.payload, cached: true };
      }

      const limit = pLimit(5);
      const settled = await Promise.all(apis.map((api) => limit(() => catalogAllForProvider(providers, api, type, category, maxPages))));
      const results = settled.flatMap((source) => source.results || []);
      const payload = {
        success: true,
        type,
        all: true,
        category,
        maxPages,
        sources: settled.map(({ api, ok, ms, pagesFetched, totalPages, error: message, results: rows }) => ({
          api,
          ok,
          ms,
          pagesFetched,
          totalPages,
          count: (rows || []).length,
          error: message || null,
        })),
        results,
        total: results.length,
        cached: false,
      };
      catalogAllCache.set(cacheKey, { expires: Date.now() + CATALOG_ALL_TTL_MS, payload });
      return payload;
    }

    const limit = pLimit(5);
    const settled = await Promise.all(apis.map((api) => limit(async () => {
      const provider = providers.get(api);
      const begin = Date.now();
      try {
        const data = await withTimeout(() => catalogFetchPage(provider, api, type, page, category), SEARCH_TIMEOUT, api);
        return { api, ok: true, ms: Date.now() - begin, results: data?.results || [], pagination: data?.pagination || null };
      } catch (e) {
        return { api, ok: false, ms: Date.now() - begin, results: [], error: e.message || String(e) };
      }
    })));
    const results = settled.flatMap((source) => source.results || []);
    return {
      success: true,
      type,
      page,
      all: false,
      category,
      sources: settled.map(({ api, ok, ms, error: message, pagination }) => ({ api, ok, ms, error: message || null, pagination })),
      results,
      total: results.length,
    };
  });

  // Agenda oficial do widget MegaCine, enriquecida internamente pelo TMDB.
  // O app recebe os dados já normalizados e não chama o TMDB diretamente.
  app.get('/api/agenda', async (req) => content.getAgenda({ days: req.query.days }));

  app.get('/api/categories', async () => {
    const merged = new Map();
    for (const api of ['v1', 'v2', 'v3', 'v5']) {
      const provider = providers.get(api);
      if (!provider?.categories) continue;
      try {
        const { categories = [] } = provider.categories();
        for (const category of categories) {
          const existing = merged.get(category.id);
          if (existing) existing.availableIn = [...new Set([...existing.availableIn, api])];
          else merged.set(category.id, { ...category, availableIn: [api] });
        }
      } catch (_) {}
    }
    return { success: true, categories: [...merged.values()] };
  });

  // Fluxo principal do app: o ID é sempre o ID/slug da fonte presente no card.
  // O servidor consulta os detalhes do provider e, em seguida, enriquece pelo TMDB.
  app.get('/api/content/:api/:id', async (req) => content.getDetails(req.params.api, req.params.id, {
    type: req.query.type,
    title: req.query.title,
    year: req.query.year,
  }));

  // Rotas originais de detalhes, agora usando o microserviço TMDB fornecido.
  app.get('/v2/title', async (req, reply) => {
    const type = normalizeType(req.query.tipo || req.query.type) || 'movie';
    const id = req.query.tmdb_id || req.query.tmdbId || req.query.id;
    if (!id) return reply.code(400).send(error(null, 'INVALID_PARAMETERS', 'tmdb_id obrigatório'));
    try { return await tmdbService.getById(type, id); }
    catch (e) { return reply.code(502).send(error(null, e.code || 'TMDB_LOOKUP_FAILED', e.message || String(e))); }
  });
  app.get('/v2/filme/:tmdbId', async (req, reply) => {
    try { return await tmdbService.getById('movie', req.params.tmdbId); }
    catch (e) { return reply.code(502).send(error(null, e.code || 'TMDB_LOOKUP_FAILED', e.message || String(e))); }
  });
  app.get('/v2/serie/:tmdbId', async (req, reply) => {
    try { return await tmdbService.getById('series', req.params.tmdbId); }
    catch (e) { return reply.code(502).send(error(null, e.code || 'TMDB_LOOKUP_FAILED', e.message || String(e))); }
  });
  app.get('/v2/calendar', async (req) => content.getAgenda({ days: req.query.days || 14 }));
  app.get('/v2/calendar/:days', async (req) => content.getAgenda({ days: req.params.days }));

  // Compatibilidade com os endpoints originais Donflix por TMDB ID.
  app.get('/v2/video/filme/:tmdbId', async (req) => content.play('v1', req.params.tmdbId, { type: 'movie', tmdbId: req.params.tmdbId }));
  app.get('/v2/video/serie/:tmdbId/:season/:episode', async (req) => content.play('v1', req.params.tmdbId, { type: 'series', tmdbId: req.params.tmdbId, season: req.params.season, episode: req.params.episode }));

  // Resolver o vídeo somente quando o usuário clicar em Assistir/Continuar.
  app.get('/api/play/:api/:id', async (req) => content.play(req.params.api, req.params.id, {
    type: req.query.type,
    season: req.query.season,
    episode: req.query.episode,
    player: req.query.player,
    title: req.query.title,
    year: req.query.year,
  }));

  return app;
}

async function start() {
  const app = createApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`TEDFLIX Content Server listening on http://${HOST}:${PORT}`);
    app.log.info(`TMDB metadata service: ${process.env.TMDB_API_URL || process.env.TMDB_BASE_URL || 'https://tmdb.tedflix.site'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (require.main === module) start();

module.exports = { createApp, start };
