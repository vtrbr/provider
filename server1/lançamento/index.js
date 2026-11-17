'use strict';

/**
 * GET /lancamentos  (?year=2026)
 * Fonte: https://www.seriesflixhit.com/lancamentos/{year}
 * Devolve: capa, nome, ano, tipo, link → /v5/play/{url}
 */

const axios = require('axios');
const cheerio = require('cheerio');
const NodeHttp = require('http');

const BASE = (process.env.SERIESFLIX_URL || 'https://www.seriesflixhit.com').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');
const PLAY_PREFIX = `${PUBLIC_API}/v5/play/`;

const DEFAULT_YEAR = Number(process.env.SERIESFLIX_YEAR) || new Date().getFullYear();
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

function cleanTitle(title) {
  return String(title || '')
    .replace(/^Assistir\s+/i, '')
    .replace(/\s+online\s+gr[aá]tis$/i, '')
    .replace(/\s+online$/i, '')
    .replace(/&amp;/g, '&')
    .trim();
}

function parsePage(html, year) {
  const $ = cheerio.load(html);
  const items = [];

  $('a.card[href]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');
    if (!href) return;
    if (!/\/filmes\/|\/serie\//i.test(href)) return;

    const title =
      cleanTitle($el.find('h3').first().text()) ||
      cleanTitle($el.attr('title')) ||
      null;
    if (!title) return;

    const cover = absUrl($el.find('img').first().attr('src') || null);
    const meta = ($el.find('.card-overlay span').first().text() || '').trim();
    // "12/11/2026 · Filme" | "06/11/2026 · Série"
    let itemYear = year || null;
    let type = /\/serie\//i.test(href) ? 'series' : 'movie';
    const yearM = meta.match(/\b((?:19|20)\d{2})\b/);
    if (yearM) itemYear = parseInt(yearM[1], 10);
    if (/s[eé]rie/i.test(meta)) type = 'series';
    if (/filme/i.test(meta)) type = 'movie';

    // fallback year from alt
    if (!itemYear) {
      const alt = $el.find('img').attr('alt') || '';
      const am = alt.match(/\b((?:19|20)\d{2})\b/);
      if (am) itemYear = parseInt(am[1], 10);
    }

    const pageUrl = absUrl(href);
    items.push({
      title,
      year: itemYear,
      cover,
      type,
      link: PLAY_PREFIX + pageUrl,
      source: 'seriesflix',
      streaming: 'lancamentos',
    });
  });

  return items;
}

const cache = new Map(); // year -> { at, data }

async function scrapeYear(year) {
  const url = `${BASE}/lancamentos/${year}`;
  const { data, status } = await http.get(url);
  if (status >= 400 || !data) {
    const e = new Error(`Lançamentos ${year} indisponível (HTTP ${status})`);
    e.status = status || 502;
    throw e;
  }
  return parsePage(data, year);
}

async function getLancamentos(year = DEFAULT_YEAR) {
  const y = Number(year) || DEFAULT_YEAR;
  const hit = cache.get(y);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return { success: true, year: y, data: hit.data, cached: true };
  }

  const data = await scrapeYear(y);
  cache.set(y, { at: Date.now(), data });
  return { success: true, year: y, data, cached: false };
}

async function handler(req, res) {
  try {
    if (req?.query?.refresh === '1') cache.clear();
    const year = req?.query?.year || DEFAULT_YEAR;
    res.json(await getLancamentos(year));
  } catch (err) {
    console.error('[lancamentos] error:', err.message);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

module.exports = { handler, getLancamentos };
