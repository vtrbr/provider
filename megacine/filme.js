'use strict';
/**
 * GET /topfilmes/filmes
 *
 * Fonte: topfilmes.biz — seção "Últimos Filmes Adicionados" da home (/home)
 * Paginação: 1 → 151  (via /home?p=N)
 * Play prefix: https://api.tedflix.site/v4/play/
 * Cache: 24h
 *
 * Express / Fastify:
 *   const { handler } = require('./filmes_topfilmes');
 *   app.get('/topfilmes/filmes', handler);
 *
 * Uso direto:
 *   const { getTopfilmesFilmes } = require('./filmes_topfilmes');
 *   const data = await getTopfilmesFilmes();
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

// ---------- Config ----------
const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');
const PLAY_PREFIX = `${PUBLIC_API}/v4/play/`;

const SOURCE = 'topfilmes';
const MAX_PAGES = 151;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const CONCURRENCY = 6;

// ---------- HTTP ----------
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

// ---------- Helpers ----------
function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (/^https?:\/\//i.test(href)) return href;
  return BASE + (href.startsWith('/') ? href : '/' + href);
}

function pageUrl(page) {
  return page <= 1
    ? `${BASE}/home`
    : `${BASE}/home?p=${page}`;
}

// ---------- Parser ----------
function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];

  // só os cards da seção "Últimos Filmes Adicionados" (.filmes .filme)
  // (o carrossel de destaques usa .scrolling-wrapper .card, então não bate)
  $('.filmes .filme').each((_, el) => {
    const $el = $(el);

    const $a = $el.find('a[href*="/assistir/"]').first();
    const href = $a.attr('href');
    if (!href) return;

    const title = $el.find('.title').first().text().trim();
    if (!title) return;

    const year = $el.find('.year').first().text().trim() || null;

    let rating = $el.find('.tt-imdb').first().text().trim();
    rating = rating || null;

    // data-src traz a URL limpa (sem _filter(blur))
    const $img = $el.find('img').first();
    const cover = absUrl($img.attr('data-src') || $img.attr('src') || null);

    items.push({
      title,
      year,
      rating,
      link: PLAY_PREFIX + absUrl(href),
      cover,
      source: SOURCE,
    });
  });

  return items;
}

// ---------- Fetch ----------
async function fetchPage(page, retries = 2) {
  const url = pageUrl(page);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await httpClient.get(url);
      return parsePage(data);
    } catch (err) {
      if (attempt === retries) {
        console.error(`[${SOURCE}:filmes] page ${page} FAIL: ${err.message}`);
        return [];
      }
      await sleep(400 * attempt);
    }
  }
  return [];
}

// ---------- Scrape completo ----------
async function scrapeAll() {
  const items = [];
  let cursor = 1;
  let done = 0;
  let emptyStreak = 0;
  const t0 = Date.now();

  async function worker() {
    while (cursor <= MAX_PAGES) {
      const page = cursor++;
      const pageItems = await fetchPage(page);
      for (const it of pageItems) items.push(it);
      done++;

      if (pageItems.length === 0) emptyStreak++;
      else emptyStreak = 0;

      if (emptyStreak >= 5) {
        console.log(
          `[${SOURCE}:filmes] parando em ${page} (5 páginas vazias seguidas)`
        );
        cursor = MAX_PAGES + 1;
        return;
      }

      if (done % 20 === 0 || done === MAX_PAGES) {
        console.log(
          `[${SOURCE}:filmes] ${done}/${MAX_PAGES} ` +
          `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `[${SOURCE}:filmes] DONE ${items.length} itens em ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  return items;
}

// ---------- Cache ----------
let cacheData = null;
let cacheAt = 0;
let running = null;

async function getAll() {
  if (cacheData && Date.now() - cacheAt < CACHE_TTL) return cacheData;
  if (running) return running;

  running = (async () => {
    try {
      const data = await scrapeAll();
      cacheData = data;
      cacheAt = Date.now();
      return data;
    } finally {
      running = null;
    }
  })();

  return running;
}

// ---------- API pública ----------
async function getTopfilmesFilmes() {
  const data = await getAll();
  return { success: true, data };
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    const json = await getTopfilmesFilmes();
    res.json(json);
  } catch (err) {
    console.error(`[${SOURCE}:filmes] error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getTopfilmesFilmes };
