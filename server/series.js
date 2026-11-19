'use strict';
/**
 * GET /megacine/series
 *
 * Fonte: megacine.yachts — listagem "Adicionados recentemente" de séries
 * Paginação: /series (p.1) → /series/page/117 (p.117)
 * Link: URL crua (https://megacine.yachts/series/assistir-...) — sem prefixo de API
 * Cache: 9h
 *
 * Express / Fastify:
 *   const megacineSeries = require('./megacine_series');
 *   app.get('/megacine/series', megacineSeries.handler);
 *
 * Uso direto:
 *   const { getMegacineSeries } = require('./megacine_series');
 *   const data = await getMegacineSeries();
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

// ---------- Config ----------
const BASE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');

const SOURCE = 'megacine';
const MAX_PAGES = 117;
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

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function pageUrl(page) {
  return page <= 1
    ? `${BASE}/series`
    : `${BASE}/series/page/${page}`;
}

// ---------- Parser ----------
function parsePage(html) {
  const $ = cheerio.load(html);
  const items = [];

  // apenas os cards da listagem "Adicionados recentemente"
  // (o carrossel do topo usa #slider-tvshows, então não bate)
  $('#archive-content article.item.tvshows').each((_, el) => {
    const $el = $(el);

    const $a = $el.find('.data h3 a').first();
    const href = $a.attr('href');
    if (!href) return;

    const title = decodeHtml($a.text().trim());
    if (!title) return;

    // ano — a <span> do .data vem como "Nov. 12, 2026" / "Aug. 07, 2020"
    const dateRaw = $el.find('.data > span').first().text().trim();
    const yearM = dateRaw.match(/\b(19|20)\d{2}\b/);
    const year = yearM ? yearM[0] : null;

    // capa (src vem limpo em w500)
    const $img = $el.find('.poster img').first();
    let cover = $img.attr('src') || null;
    if (cover && cover.startsWith('//')) cover = 'https:' + cover;
    else if (cover && cover.startsWith('/')) cover = BASE + cover;

    items.push({
      title,
      year,
      rating: null, // padrão megacine — sem nota
      link: absUrl(href), // URL crua do megacine
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
      const { data } = await httpClient.get(url, { Referer: `${BASE}/series` });
      return parsePage(data);
    } catch (err) {
      if (attempt === retries) {
        console.error(`[${SOURCE}:series] page ${page} FAIL: ${err.message}`);
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
          `[${SOURCE}:series] parando em ${page} (5 páginas vazias seguidas)`
        );
        cursor = MAX_PAGES + 1;
        return;
      }

      if (done % 20 === 0 || done === MAX_PAGES) {
        console.log(
          `[${SOURCE}:series] ${done}/${MAX_PAGES} ` +
          `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `[${SOURCE}:series] DONE ${items.length} itens em ` +
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
async function getMegacineSeries() {
  const data = await getAll();
  return { success: true, data };
}

function getPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }

    const page = getPositiveInt(req?.query?.page, 1);
    const requestedLimit = getPositiveInt(req?.query?.limit, 30);
    const limit = Math.min(requestedLimit, 100);

    const result = await getMegacineSeries();
    const allItems = result.data || [];
    const total = allItems.length;
    const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
    const start = (page - 1) * limit;
    const data = allItems.slice(start, start + limit);

    return res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1 && page <= totalPages,
      },
    });
  } catch (err) {
    console.error(`[${SOURCE}:series] error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getMegacineSeries };
