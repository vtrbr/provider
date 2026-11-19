'use strict';
/**
 * GET /lancamentos
 *
 * Fonte: topfilmes.biz — seção "Nossos Destaques" da home (/home)
 * Link: URL crua (https://topfilmes.biz/assistir/<slug>) — sem prefixo de API
 *
 * Express / Fastify:
 *   const { handler } = require('./lancamentos');
 *   app.get('/lancamentos', handler);
 *
 * Uso direto:
 *   const { getLancamentos } = require('./lancamentos');
 *   const data = await getLancamentos();
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

// ---------- Config ----------
const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');

const SOURCE = 'topfilmes';
const HOME_URL = `${BASE}/home`;
const CACHE_TTL = 9 * 60 * 60 * 1000; // 9h

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
  httpAgent: new NodeHttp.Agent({ keepAlive: true, maxSockets: 10 }),
});

// ---------- Helpers ----------
function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (/^https?:\/\//i.test(href)) return href;
  return BASE + (href.startsWith('/') ? href : '/' + href);
}

/** remove o filtro de blur do TMDB, se ainda aparecer */
function cleanCover(url) {
  if (!url) return null;
  // prioriza data-src (já tratado antes), mas se vier do src com filtro:
  return url.replace(/\/w\d+_filter\(blur\)\//i, '/w342/');
}

// ---------- Parser ----------
function parseHome(html) {
  const $ = cheerio.load(html);
  const items = [];

  // .scrolling-wrapper é o carrossel "Nossos Destaques"
  $('.scrolling-wrapper .card').each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a').first();
    const href = $a.attr('href');
    if (!href || !/\/assistir\//i.test(href)) return;

    const $img = $el.find('img').first();

    // título vem do title do <a> (ou alt do <img> como fallback)
    const title =
      ($a.attr('title') || $img.attr('alt') || '').trim();
    if (!title) return;

    // capa: data-src sempre tem a URL limpa (sem _filter(blur))
    const coverRaw =
      $img.attr('data-src') || $img.attr('src') || null;

    items.push({
      title,
      year: null,   // carrossel não traz ano
      rating: null, // nem nota
      link: absUrl(href), // URL crua do topfilmes
      cover: cleanCover(absUrl(coverRaw)),
      source: SOURCE,
    });
  });

  return items;
}

// ---------- Fetch ----------
async function fetchHome(retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await httpClient.get(HOME_URL);
      return parseHome(data);
    } catch (err) {
      if (attempt === retries) {
        console.error(`[${SOURCE}:destaques] FAIL: ${err.message}`);
        return [];
      }
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  return [];
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
      const data = await fetchHome();
      cacheData = data;
      cacheAt = Date.now();
      console.log(
        `[${SOURCE}:destaques] DONE ${data.length} itens em ` +
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
async function getLancamentos() {
  const data = await getAll();
  return { success: true, data };
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    const json = await getLancamentos();
    res.json(json);
  } catch (err) {
    console.error(`[${SOURCE}:destaques] error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getLancamentos };
