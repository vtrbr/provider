'use strict';
/** GET /v4/play/* — TopFilmes ficha (dados + link assistir). Sem resolver stream. */
const axios = require('axios');
const cheerio = require('cheerio');

const API = 4;
const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');
const PUBLIC_API = (process.env.PUBLIC_API_BASE || 'https://api.tedflix.site').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  validateStatus: (s) => s >= 200 && s < 500,
});

function abs(base, href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('http')) return href;
  return base.replace(/\/+$/, '') + (href.startsWith('/') ? href : '/' + href);
}

function rawFromReq(req) {
  let raw = (req.params && (req.params[0] || req.params.url)) || (req.query && (req.query.url || req.query.u)) || '';
  if (!raw && req.originalUrl) {
    const m = String(req.originalUrl).match(/\/v4\/play\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function videoLink(raw) {
  return `${PUBLIC_API}/v4/video/${encodeURIComponent(String(raw))}`;
}

function slugFromUrl(url) {
  const m = String(url || '').match(/\/assistir\/([^/?#]+)/i) || String(url || '').match(/\/player\/([^/?#]+)/i);
  if (m) return m[1];
  if (url && !/^https?:/i.test(url) && !/[\/\s]/.test(url)) return url;
  return null;
}

async function getDetail(sourceUrl) {
  const slug = slugFromUrl(sourceUrl);
  const url = slug ? `${BASE}/assistir/${slug}` : sourceUrl.startsWith('http') ? sourceUrl : abs(BASE, sourceUrl);
  const { data: html, status } = await http.get(url, { headers: { Referer: BASE + '/' } });
  if (status >= 400 || !html) {
    const e = new Error(`Página TopFilmes indisponível (HTTP ${status})`);
    e.status = status || 502;
    throw e;
  }
  const $ = cheerio.load(html);
  const resolvedSlug = slug || slugFromUrl(url) || 'unknown';
  let title =
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    resolvedSlug.replace(/-/g, ' ');
  title = String(title)
    .replace(/\s*[\-|–]\s*TopFilmes.*$/i, '')
    .replace(/^Assistir\s+/i, '')
    .replace(/^capa\s+/i, '')
    .trim();
  const poster =
    $('meta[property="og:image"]').attr('content') ||
    $('img').first().attr('data-src') ||
    $('img').first().attr('src') ||
    null;
  const overview =
    $('meta[property="og:description"]').attr('content') ||
    $('.sinopse, .description').first().text().trim() ||
    null;
  const yearM = html.match(/\b((?:19|20)\d{2})\b/);
  const year = yearM ? parseInt(yearM[1], 10) : null;

  return {
    success: true,
    api: API,
    source: 'topfilmes',
    type: 'movie',
    id: resolvedSlug,
    title,
    year,
    poster: poster ? abs(BASE, poster) : null,
    overview,
    sourceUrl: url,
    watch: videoLink(`${BASE}/player/${resolvedSlug}?player=1`),
  };
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v4/play/' });
    return res.json(await getDetail(raw));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha TopFilmes play' });
  }
}

module.exports = { handler, getDetail, API, source: 'topfilmes' };
