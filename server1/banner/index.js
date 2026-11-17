'use strict';

/**
 * GET /banner
 * MegaCine — seção LANÇAMENTOS / destacados (#featured-titles)
 * https://megacine.yachts/
 * Devolve capa, nome, ano, tipo, link → /v1/play/...
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

const BASE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');
const PLAY_PREFIX = `${PUBLIC_API}/v1/play/`;
const CACHE_TTL = 9 * 60 * 60 * 1000;

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
  httpAgent: new NodeHttp.Agent({ keepAlive: true, maxSockets: 20 }),
});

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('http')) return href;
  return BASE + (href.startsWith('/') ? href : '/' + href);
}

function decodeHtml(s) {
  return String(s || '')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseFeatured(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  // #featured-titles = LANÇAMENTOS / DESTACADO
  let $arts = $('#featured-titles article.item');
  if (!$arts.length) $arts = $('article.item.movies, article.item.tvshows').filter((_, el) => {
    return $(el).find('.featu').length > 0 || /DESTACADO/i.test($(el).text());
  });

  $arts.each((_, el) => {
    const $el = $(el);
    const $a =
      $el.find('.data a').first().length
        ? $el.find('.data a').first()
        : $el.find('a[href*="/filmes/"], a[href*="/series/"], a[href*="/filme"], a[href*="/serie"]').first();
    const href = $a.attr('href') || $el.find('a[href]').first().attr('href');
    if (!href) return;
    const key = href.replace(/\/+$/, '');
    if (seen.has(key)) return;
    seen.add(key);

    const title = decodeHtml(
      $el.find('.data h3 a, .data h3, h3 a, h3').first().text() ||
        $el.find('img').attr('alt') ||
        ''
    );
    if (!title) return;

    const yearText = $el.find('.data span, .dfeatur span').first().text().trim();
    const yearM = yearText.match(/\b((?:19|20)\d{2})\b/);
    const year = yearM ? parseInt(yearM[1], 10) : null;

    let cover =
      $el.find('.poster img').attr('data-src') ||
      $el.find('.poster img').attr('src') ||
      $el.find('img').attr('src') ||
      null;
    cover = absUrl(cover);

    const isSeries =
      $el.hasClass('tvshows') ||
      /\/series?\//i.test(href) ||
      /tvshows/i.test($el.attr('class') || '');

    const pageUrl = absUrl(href);
    items.push({
      title,
      year,
      cover,
      type: isSeries ? 'series' : 'movie',
      link: PLAY_PREFIX + pageUrl,
      source: 'megacine',
      section: 'lancamentos',
      featured: true,
    });
  });

  return items;
}

let cacheData = null;
let cacheAt = 0;
let running = null;

async function getBanner() {
  if (cacheData && Date.now() - cacheAt < CACHE_TTL) {
    return { success: true, data: cacheData, cached: true };
  }
  if (running) return running;

  running = (async () => {
    try {
      const { data, status } = await http.get(`${BASE}/`);
      if (status >= 400 || !data) {
        const e = new Error(`MegaCine home indisponível (HTTP ${status})`);
        e.status = status || 502;
        throw e;
      }
      const items = parseFeatured(data);
      cacheData = items;
      cacheAt = Date.now();
      return { success: true, data: items, cached: false };
    } finally {
      running = null;
    }
  })();

  return running;
}

async function handler(req, res) {
  try {
    if (req?.query?.refresh === '1') {
      cacheData = null;
      cacheAt = 0;
    }
    res.json(await getBanner());
  } catch (err) {
    console.error('[banner] error:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getBanner };
