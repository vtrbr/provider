'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');

// ---------- Config ----------
const CACHE_TTL = 9 * 60 * 60 * 1000; // 9h
const CONCURRENCY = 6;
const TIMEOUT = 20000;

const PLAY = {
  megacine:     'https://api.tedflix.site/v1/play/',
  megaflix:     'https://api.tedflix.site/v2/play/',
  megafilmeshd: 'https://api.tedflix.site/v3/play/',
};

// ---------- HTTP ----------
const agent = new http.Agent({ keepAlive: true, maxSockets: 30 });
const httpClient = axios.create({
  timeout: TIMEOUT,
  httpAgent: agent,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function absUrl(base, href) {
  if (!href) return null;
  if (href.startsWith('http')) return href;
  return base + (href.startsWith('/') ? href : '/' + href);
}

// ---------- Parsers (idênticos ao módulo de filmes) ----------

function parseMegaflix($) {
  const items = [];
  $('.poster.grid-item').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.poster__title a').first();
    const href = $a.attr('href');
    if (!href) return;

    const title = ($a.find('span').first().text() || $a.text()).trim();
    if (!title) return;

    const year = $el.find('.bslide__meta span').first().text().trim() || null;
    const rating =
      $el.find('.rating.roundnum, .rating').first().text().trim() || null;

    let cover = $el.find('.poster__img img').first().attr('src') || null;
    if (cover && cover.startsWith('?')) cover = null;
    else if (cover && cover.startsWith('/')) cover = 'https://megaflix.live' + cover;

    items.push({
      title,
      year,
      rating,
      link: PLAY.megaflix + absUrl('https://megaflix.live', href),
      cover,
      source: 'megaflix',
    });
  });
  return items;
}

function parseMegacine($) {
  const items = [];
  $('article.item').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.image > a').first();
    const href = $a.attr('href');
    if (!href) return;

    const title = $el.find('.title').first().text().trim();
    if (!title) return;

    const year = $el.find('.data span').first().text().trim() || null;
    const cover = $el.find('.image > a img').first().attr('src') || null;

    items.push({
      title,
      year,
      rating: null,
      link: PLAY.megacine + absUrl('https://megacine.yachts', href),
      cover,
      source: 'megacine',
    });
  });
  return items;
}

function parseMegafilmeshd($) {
  const items = [];
  $('.browse-grid .browse-card--index').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a.browse-card-link').first();
    const href = $a.attr('href');
    if (!href) return;

    const title = $el.find('.browse-card-title').first().text().trim();
    if (!title) return;

    const year = $el.find('.browse-year').first().text().trim() || null;

    let rating = $el.find('.browse-rating-pill').first().text().trim();
    rating = rating ? rating.replace(/^★\s*/, '').trim() || null : null;

    let cover = $el.find('.browse-card-poster img').first().attr('src') || null;
    if (cover && cover.startsWith('/')) cover = 'https://megafilmeshd1.com' + cover;

    items.push({
      title,
      year,
      rating,
      link: PLAY.megafilmeshd + absUrl('https://megafilmeshd1.com', href),
      cover,
      source: 'megafilmeshd',
    });
  });
  return items;
}

// ---------- Fontes (séries) ----------
const SOURCES = [
  {
    name: 'megaflix',
    maxPages: 41,
    url: (p) =>
      p <= 1
        ? 'https://megaflix.live/series/'
        : `https://megaflix.live/series/page/${p}/`,
    parse: parseMegaflix,
  },
  {
    name: 'megacine',
    maxPages: 117,
    url: (p) =>
      p <= 1
        ? 'https://megacine.yachts/series'
        : `https://megacine.yachts/series/page/${p}`,
    parse: parseMegacine,
  },
  {
    name: 'megafilmeshd',
    maxPages: 222,
    url: (p) =>
      `https://megafilmeshd1.com/series?page=${p}&sort=recent`,
    parse: parseMegafilmeshd,
  },
];

// ---------- Fetch ----------
async function fetchPage(source, page, retries = 2) {
  const url = source.url(page);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await httpClient.get(url);
      const $ = cheerio.load(data);
      return source.parse($).map((it) => ({ ...it, page }));
    } catch (err) {
      if (attempt === retries) {
        console.error(`[${source.name}] page ${page} FAIL: ${err.message}`);
        return [];
      }
      await sleep(400 * attempt);
    }
  }
  return [];
}

async function scrapeSource(source) {
  const items = [];
  let cursor = 1;
  let done = 0;
  const t0 = Date.now();

  async function worker() {
    while (cursor <= source.maxPages) {
      const page = cursor++;
      const pageItems = await fetchPage(source, page);
      for (const it of pageItems) items.push(it);
      done++;
      if (done % 50 === 0) {
        console.log(
          `[${source.name}] ${done}/${source.maxPages} ` +
          `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `[${source.name}] DONE ${items.length} itens em ` +
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
      const t0 = Date.now();
      const results = await Promise.all(SOURCES.map(scrapeSource));
      const data = results.flat();
      cacheData = data;
      cacheAt = Date.now();
      console.log(
        `[catalog:series] TOTAL ${data.length} itens em ` +
        `${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
      return data;
    } finally {
      running = null;
    }
  })();

  return running;
}

// ---------- API pública ----------
async function getCatalogSeries() {
  const data = await getAll();
  return { success: true, data };
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    const json = await getCatalogSeries();
    res.json(json);
  } catch (err) {
    console.error('[catalog:series] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getCatalogSeries };
