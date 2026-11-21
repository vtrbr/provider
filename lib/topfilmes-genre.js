'use strict';

/**
 * Categorias — união TopFilmes + MegaCine
 * Scrape todas as páginas, cache 24h, paginação na resposta (?page=&limit=)
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

const TOPFILMES = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const MEGACINE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');

const CACHE_TTL = 24 * 60 * 60 * 1000;
const CONCURRENCY = 6;
const MAX_PAGES = 80;

const httpClient = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
  httpAgent: new NodeHttp.Agent({ keepAlive: true, maxSockets: 30 }),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function absUrl(base, href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (/^https?:\/\//i.test(href)) return href;
  return String(base).replace(/\/+$/, '') + (href.startsWith('/') ? href : '/' + href);
}

function getPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTopfilmes(html) {
  const $ = cheerio.load(html || '');
  const items = [];
  $('.filmes .filme, .filme').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a[href*="/assistir/"]').first();
    const href = $a.attr('href');
    if (!href) return;
    const title = $el.find('.title').first().text().trim();
    if (!title) return;
    const year = $el.find('.year').first().text().trim() || null;
    let rating = $el.find('.tt-imdb').first().text().trim() || null;
    const $img = $el.find('img').first();
    const cover = absUrl(TOPFILMES, $img.attr('data-src') || $img.attr('src') || null);
    items.push({
      title,
      year,
      rating,
      link: absUrl(TOPFILMES, href),
      cover,
      source: 'topfilmes',
      type: 'movie',
    });
  });
  return items;
}

function parseMegacine(html) {
  const $ = cheerio.load(html || '');
  const items = [];
  $('article.item, .item.movies, .item.tvshows').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.image > a, a[href*="/series/"], a[href*="/filmes/"]').first();
    const href = $a.attr('href');
    if (!href) return;
    const title = (
      $el.find('.title, .data h3, h3').first().text() ||
      $a.attr('title') ||
      ''
    ).trim();
    if (!title) return;
    const year = $el.find('.year, .data span').first().text().trim() || null;
    let rating = $el.find('.rating, .imdb').first().text().trim() || null;
    if (rating) rating = rating.replace(/^★\s*/, '').trim() || null;
    let cover =
      $el.find('img').first().attr('data-src') ||
      $el.find('img').first().attr('src') ||
      null;
    cover = absUrl(MEGACINE, cover);
    const isSeries = /\/series\//i.test(href) || $el.hasClass('tvshows');
    items.push({
      title,
      year,
      rating,
      link: absUrl(MEGACINE, href),
      cover,
      source: 'megacine',
      type: isSeries ? 'series' : 'movie',
    });
  });
  return items;
}

/**
 * Lista completa de categorias (união dos dois sites)
 * topfilmes: /genero/{slug}
 * megacine:  /generos/{slug}
 */
const GENRES = [
  { slug: 'acao', label: 'Ação', topfilmes: true, megacine: true },
  { slug: 'animacao', label: 'Animação', topfilmes: true, megacine: true },
  { slug: 'aventura', label: 'Aventura', topfilmes: false, megacine: true },
  { slug: 'comedia', label: 'Comédia', topfilmes: true, megacine: true },
  { slug: 'crime', label: 'Crime', topfilmes: false, megacine: true },
  { slug: 'documentario', label: 'Documentário', topfilmes: true, megacine: true },
  { slug: 'drama', label: 'Drama', topfilmes: true, megacine: true },
  { slug: 'familia', label: 'Família', topfilmes: false, megacine: true },
  { slug: 'fantasia', label: 'Fantasia', topfilmes: true, megacine: true },
  { slug: 'faroeste', label: 'Faroeste', topfilmes: true, megacine: true },
  { slug: 'ficcao-cientifica', label: 'Ficção Científica', topfilmes: true, megacine: true },
  { slug: 'guerra', label: 'Guerra', topfilmes: false, megacine: true },
  { slug: 'historia', label: 'História', topfilmes: false, megacine: true },
  { slug: 'kids', label: 'Kids', topfilmes: false, megacine: true },
  { slug: 'misterio', label: 'Mistério', topfilmes: true, megacine: true },
  { slug: 'musica', label: 'Música', topfilmes: false, megacine: true },
  { slug: 'nacionais', label: 'Nacionais', topfilmes: true, megacine: false },
  { slug: 'policial', label: 'Policial', topfilmes: true, megacine: false },
  { slug: 'reality', label: 'Reality', topfilmes: false, megacine: true },
  { slug: 'romance', label: 'Romance', topfilmes: true, megacine: true },
  { slug: 'suspense', label: 'Suspense', topfilmes: true, megacine: false },
  { slug: 'terror', label: 'Terror', topfilmes: true, megacine: true },
];

function createGenre(opts) {
  const slug = opts.slug;
  const label = opts.label || slug;
  const useTop = !!opts.topfilmes;
  const useMega = !!opts.megacine;
  const tag = 'categoria:' + slug;

  async function fetchTopPage(page, retries) {
    retries = retries || 2;
    const url =
      page <= 1
        ? TOPFILMES + '/genero/' + slug
        : TOPFILMES + '/genero/' + slug + '?p=' + page;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await httpClient.get(url);
        if (res.status >= 400 || !res.data) return [];
        return parseTopfilmes(res.data);
      } catch (err) {
        if (attempt === retries) {
          console.error('[' + tag + ':topfilmes] page ' + page + ' FAIL: ' + err.message);
          return [];
        }
        await sleep(400 * attempt);
      }
    }
    return [];
  }

  async function fetchMegaPage(page, retries) {
    retries = retries || 2;
    const url =
      page <= 1
        ? MEGACINE + '/generos/' + slug
        : MEGACINE + '/generos/' + slug + '/page/' + page;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await httpClient.get(url);
        if (res.status >= 400 || !res.data) return [];
        return parseMegacine(res.data);
      } catch (err) {
        if (attempt === retries) {
          console.error('[' + tag + ':megacine] page ' + page + ' FAIL: ' + err.message);
          return [];
        }
        await sleep(400 * attempt);
      }
    }
    return [];
  }

  async function scrapeSource(name, fetchPage) {
    const items = [];
    let cursor = 1;
    let emptyStreak = 0;
    const t0 = Date.now();

    async function worker() {
      while (cursor <= MAX_PAGES) {
        const page = cursor++;
        const pageItems = await fetchPage(page);
        for (let i = 0; i < pageItems.length; i++) {
          items.push(Object.assign({}, pageItems[i], { category: slug }));
        }
        if (pageItems.length === 0) emptyStreak++;
        else emptyStreak = 0;
        if (emptyStreak >= 5) {
          console.log('[' + tag + ':' + name + '] parando em ' + page + ' (paginas vazias)');
          cursor = MAX_PAGES + 1;
          return;
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(
      '[' + tag + ':' + name + '] ' + items.length + ' itens em ' +
      ((Date.now() - t0) / 1000).toFixed(1) + 's'
    );
    return items;
  }

  let cacheData = null;
  let cacheAt = 0;
  let running = null;

  async function getAll() {
    if (cacheData && Date.now() - cacheAt < CACHE_TTL) return cacheData;
    if (running) return running;

    running = (async function () {
      try {
        const tasks = [];
        if (useTop) tasks.push(scrapeSource('topfilmes', fetchTopPage));
        if (useMega) tasks.push(scrapeSource('megacine', fetchMegaPage));
        const parts = await Promise.all(tasks);
        const merged = [].concat.apply([], parts);

        const seen = new Set();
        const unique = [];
        for (let i = 0; i < merged.length; i++) {
          const it = merged[i];
          const key = it.link || (it.source + ':' + it.title);
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(it);
        }

        cacheData = unique;
        cacheAt = Date.now();
        console.log('[' + tag + '] TOTAL ' + unique.length + ' itens');
        return unique;
      } finally {
        running = null;
      }
    })();

    return running;
  }

  async function handler(req, res) {
    try {
      if (req && req.query && req.query.refresh === '1') {
        cacheData = null;
        cacheAt = 0;
      }

      const page = getPositiveInt(req && req.query && req.query.page, 1);
      const requestedLimit = getPositiveInt(req && req.query && req.query.limit, 30);
      const limit = Math.min(requestedLimit, 100);

      const allItems = await getAll();
      const total = allItems.length;
      const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
      const start = (page - 1) * limit;
      const data = allItems.slice(start, start + limit);

      const sources = [];
      if (useTop) sources.push('topfilmes');
      if (useMega) sources.push('megacine');

      return res.json({
        success: true,
        category: slug,
        label: label,
        sources: sources,
        data: data,
        pagination: {
          page: page,
          limit: limit,
          total: total,
          totalPages: totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1 && page <= totalPages,
        },
      });
    } catch (err) {
      console.error('[' + tag + '] error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return { handler: handler, getAll: getAll };
}

function createGenreHandler(slug, label) {
  const meta = GENRES.find(function (g) { return g.slug === slug; }) || {
    slug: slug,
    label: label,
    topfilmes: true,
    megacine: false,
  };
  return createGenre(meta);
}

module.exports = {
  createGenre: createGenre,
  createGenreHandler: createGenreHandler,
  GENRES: GENRES,
  TOPFILMES: TOPFILMES,
  MEGACINE: MEGACINE,
};
