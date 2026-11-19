'use strict';
/**
 * GET /banner
 *
 * Fonte: megacine.yachts — hero/banner da home (/)
 * Seletor: article.mc-hero-slide
 * Link: URL crua (megacine.yachts/...) — sem prefixo de API
 * Cache: 9h
 *
 * Express / Fastify:
 *   const banner = require('./banner');
 *   app.get('/banner', banner.handler);
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

// ---------- Config ----------
const BASE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');
const SOURCE = 'megacine';
const HOME_URL = `${BASE}/`;
const CACHE_TTL = 1 * 60 * 60 * 1000; // 1h

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

function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&hellip;/g, '…')
    .replace(/\s+/g, ' ')
    .trim();
}

/** extrai URL de dentro de `background-image:url(...)` */
function extractBgUrl(style) {
  if (!style) return null;
  const m = String(style).match(/url\((['"]?)([^)'"]+)\1\)/i);
  return m ? m[2] : null;
}

// ---------- Parser ----------
function parseBanner(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('article.mc-hero-slide').each((_, el) => {
    const $el = $(el);

    // título — alt da logo
    const $logo = $el.find('.mc-hero-logo').first();
    const title = ($logo.attr('alt') || '').trim();
    if (!title) return;

    // logos / backdrop
    const logo = absUrl($logo.attr('src'));
    const backdrop = absUrl(
      extractBgUrl($el.find('.mc-hero-bg').first().attr('style'))
    );

    // nota (strong dentro do mc-hero-rating)
    const ratingText = $el.find('.mc-hero-rating strong').first().text().trim();
    const rating = ratingText || null;

    // meta (ex: "★ 7.5 Série - 2022") → extrai tipo e ano
    const metaText = decodeHtml($el.find('.mc-hero-rating').first().text());
    const metaMatch = metaText.match(/(Filme|S[ée]rie)\s*[-–]\s*(\d{4})/i);
    const type = metaMatch ? metaMatch[1] : null;
    const year = metaMatch ? metaMatch[2] : null;

    // descrição
    const desc = decodeHtml($el.find('.mc-hero-desc').first().text()) || null;

    // tags
    const tags = [];
    $el.find('.mc-hero-tag').each((_, t) => {
      const txt = decodeHtml($(t).text());
      if (txt) tags.push(txt);
    });

    // link do botão "Assistir"
    const $a = $el.find('.mc-hero-actions a.mc-hero-btn-primary').first();
    const link = absUrl($a.attr('href'));
    if (!link) return;

    items.push({
      title,
      type,
      year,
      rating,
      desc,
      tags,
      link,
      logo,
      backdrop,
      source: SOURCE,
    });
  });

  return items;
}

// ---------- Fetch ----------
async function fetchHome(retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const { data } = await httpClient.get(HOME_URL, {
        Referer: `${BASE}/`,
      });
      return parseBanner(data);
    } catch (err) {
      if (attempt === retries) {
        console.error(`[${SOURCE}:banner] FAIL: ${err.message}`);
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
        `[${SOURCE}:banner] DONE ${data.length} slides em ` +
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
async function getBanner() {
  const data = await getAll();
  return { success: true, data };
}

async function handler(req, res) {
  try {
    if (req && req.query && req.query.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    const json = await getBanner();
    res.json(json);
  } catch (err) {
    console.error(`[${SOURCE}:banner] error:`, err);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getBanner };
