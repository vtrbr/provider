'use strict';

/** GET /v3/disney/filmes — MegaFilmesHD1 Disney+ (filmes) com paginação 1..60 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

const API = 3;
const BASE = (process.env.MEGAFILMES_URL || 'https://megafilmeshd1.com').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const PLAY_PREFIX = `${PUBLIC_API}/v3/play/`;
const STREAMING = 'disney-plus';
const MAX_PAGES = 60;
const CACHE_TTL = 9 * 60 * 60 * 1000;
const CONCURRENCY = 6;

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
  httpAgent: new NodeHttp.Agent({ keepAlive: true, maxSockets: 30 }),
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  return BASE + (href.startsWith('/') ? href : '/' + href);
}

function pageUrl(page) {
  return `${BASE}/streaming/${STREAMING}?page=${page}&tab=filmes`;
}

function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('.browse-grid .browse-card').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a.browse-card-link').first();
    const href = $a.attr('href');
    if (!href) return;
    // só filmes
    if (!href.includes('/filme/') && !href.includes('/filmes/')) return;

    const title = $el.find('.browse-card-title').first().text().trim();
    if (!title) return;

    const year = $el.find('.browse-year').first().text().trim() || null;

    let rating = $el.find('.browse-rating-pill').first().text().trim();
    rating = rating ? rating.replace(/^★\s*/, '').trim() || null : null;

    let cover = $el.find('.browse-card-poster img').first().attr('src') || null;
    if (cover && cover.startsWith('/')) cover = BASE + cover;

    items.push({
      title,
      year,
      rating,
      link: PLAY_PREFIX + absUrl(href),
      cover,
      source: 'megafilmeshd',
      streaming: STREAMING,
    });
  });

  return items;
}

async function fetchPage(page, retries = 2) {
  const url = pageUrl(page);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await http.get(url);
      return parsePage(data).map((it) => ({ ...it, page }));
    } catch (err) {
      if (attempt === retries) {
        console.error(`[disney:filmes] page ${page} FAIL: ${err.message}`);
        return [];
      }
      await sleep(400 * attempt);
    }
  }
  return [];
}

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
        console.log(`[disney:filmes] parando em ${page} (5 vazias seguidas)`);
        cursor = MAX_PAGES + 1;
        return;
      }

      if (done % 20 === 0 || done === MAX_PAGES) {
        console.log(
          `[disney:filmes] ${done}/${MAX_PAGES} ` +
          `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `[disney:filmes] DONE ${items.length} itens em ` +
    `${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
  return items;
}

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

async function getFilmes() {
  const data = await getAll();
  return { success: true, data };
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    const json = await getFilmes();
    res.json(json);
  } catch (err) {
    console.error('[disney:filmes] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getFilmes, getDisneyFilmes: getFilmes };
