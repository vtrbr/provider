'use strict';

/**
 * GET /novos
 * TopFilmes — seção "Nossos Destaques" (https://topfilmes.biz/home)
 * Devolve capa, nome, link → /v4/play/...
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');
const PLAY_PREFIX = `${PUBLIC_API}/v4/play/`;
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

function parseDestaques(html) {
  const $ = cheerio.load(html);
  const items = [];
  const seen = new Set();

  // Seção "Nossos Destaques" → .scrolling-wrapper .card
  let $cards = $();
  $('h2').each((_, el) => {
    const t = $(el).text().trim();
    if (/nossos\s+destaques/i.test(t)) {
      $cards = $(el).nextAll('.scrolling-wrapper').first().find('.card');
      return false;
    }
  });
  if (!$cards.length) $cards = $('.scrolling-wrapper .card');

  $cards.each((_, el) => {
    const $el = $(el);
    const $a = $el.find('a[href*="/assistir/"]').first();
    const href = $a.attr('href');
    if (!href) return;
    const key = href.replace(/\/+$/, '');
    if (seen.has(key)) return;
    seen.add(key);

    const title = ($a.attr('title') || $a.find('img').attr('alt') || '').trim();
    if (!title) return;

    const $img = $a.find('img').first();
    let cover = $img.attr('data-src') || $img.attr('src') || null;
    // evita blur do placeholder
    if (cover && /_filter\(blur\)/i.test(cover)) {
      cover = cover.replace(/_filter\(blur\)/i, '');
    }
    cover = absUrl(cover);

    const pageUrl = absUrl(href);
    items.push({
      title,
      year: null,
      cover,
      type: 'movie',
      link: PLAY_PREFIX + pageUrl,
      source: 'topfilmes',
      section: 'destaques',
    });
  });

  return items;
}

let cacheData = null;
let cacheAt = 0;
let running = null;

async function getNovos() {
  if (cacheData && Date.now() - cacheAt < CACHE_TTL) {
    return { success: true, data: cacheData, cached: true };
  }
  if (running) return running;

  running = (async () => {
    try {
      const { data, status } = await http.get(`${BASE}/home`);
      if (status >= 400 || !data) {
        const e = new Error(`TopFilmes home indisponível (HTTP ${status})`);
        e.status = status || 502;
        throw e;
      }
      const items = parseDestaques(data);
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
    res.json(await getNovos());
  } catch (err) {
    console.error('[novos] error:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getNovos };
