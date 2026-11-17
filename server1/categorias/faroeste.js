'use strict';

/**
 * GET /categoria/faroeste
 * Categoria: Faroeste
 * Fontes: topfilmes, megacine
 * Play: megacine → v1/play | topfilmes → v4/play
 * Cache: 9h
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

const TOPFILMES = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const MEGACINE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const PLAY_V1 = `${PUBLIC_API}/v1/play/`;
const PLAY_V4 = `${PUBLIC_API}/v4/play/`;

const GENRE = 'faroeste';
const GENRE_LABEL = 'Faroeste';
const CACHE_TTL = 9 * 60 * 60 * 1000;
const CONCURRENCY = 6;

const http = axios.create({
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
  if (href.startsWith('http')) return href;
  return base + (href.startsWith('/') ? href : '/' + href);
}

function parseTopfilmes(html, playPrefix) {
  const $ = cheerio.load(html);
  const items = [];
  $('.filme').each((_, el) => {
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
      link: playPrefix + absUrl(TOPFILMES, href),
      cover,
      source: 'topfilmes',
      category: GENRE,
    });
  });
  return items;
}

function parseMegacine(html, playPrefix) {
  const $ = cheerio.load(html);
  const items = [];
  $('article.item').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('.image > a, a').first();
    const href = $a.attr('href');
    if (!href) return;
    const title = ($el.find('.title, .data h3, h3').first().text() || $a.attr('title') || '').trim();
    if (!title) return;
    const year = $el.find('.year, .data span').first().text().trim() || null;
    let rating = $el.find('.rating, .imdb').first().text().trim() || null;
    if (rating) rating = rating.replace(/^★\s*/, '').trim() || null;
    let cover =
      $el.find('img').first().attr('data-src') ||
      $el.find('img').first().attr('src') ||
      null;
    cover = absUrl(MEGACINE, cover);
    items.push({
      title,
      year,
      rating,
      link: playPrefix + absUrl(MEGACINE, href),
      cover,
      source: 'megacine',
      category: GENRE,
    });
  });
  return items;
}

const SOURCES = [
  {
    name: 'topfilmes',
    maxPages: 2,
    playPrefix: PLAY_V4,
    pageUrl: (page) =>
      page <= 1
        ? `${TOPFILMES}/genero/faroeste`
        : `${TOPFILMES}/genero/faroeste?p=${page}`,
    parse: parseTopfilmes,
  },
  {
    name: 'megacine',
    maxPages: 3,
    playPrefix: PLAY_V1,
    pageUrl: (page) =>
      page <= 1
        ? `${MEGACINE}/generos/faroeste`
        : `${MEGACINE}/generos/faroeste/page/${page}`,
    parse: parseMegacine,
  }
];

async function fetchPage(source, page, retries = 2) {
  const url = source.pageUrl(page);
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await http.get(url);
      return source.parse(data, source.playPrefix).map((it) => ({ ...it, page }));
    } catch (err) {
      if (attempt === retries) {
        console.error(`[${source.name}:faroeste] page ${page} FAIL: ${err.message}`);
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
  let emptyStreak = 0;
  const t0 = Date.now();
  const maxPages = source.maxPages;

  async function worker() {
    while (cursor <= maxPages) {
      const page = cursor++;
      const pageItems = await fetchPage(source, page);
      for (const it of pageItems) items.push(it);
      done++;

      if (pageItems.length === 0) emptyStreak++;
      else emptyStreak = 0;

      if (emptyStreak >= 5) {
        console.log(`[${source.name}:faroeste] parando em ${page} (5 vazias)`);
        cursor = maxPages + 1;
        return;
      }

      if (done % 10 === 0 || done === maxPages) {
        console.log(
          `[${source.name}:faroeste] ${done}/${maxPages} ` +
          `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(
    `[${source.name}:faroeste] DONE ${items.length} itens em ` +
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
      const results = await Promise.all(SOURCES.map(scrapeSource));
      const data = results.flat();
      cacheData = data;
      cacheAt = Date.now();
      console.log(`[categoria:faroeste] TOTAL ${data.length} itens`);
      return data;
    } finally {
      running = null;
    }
  })();

  return running;
}

async function getCategoria() {
  const data = await getAll();
  return {
    success: true,
    category: GENRE,
    label: GENRE_LABEL,
    sources: SOURCES.map((s) => s.name),
    data,
  };
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    res.json(await getCategoria());
  } catch (err) {
    console.error(`[categoria:faroeste] error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getCategoria };
