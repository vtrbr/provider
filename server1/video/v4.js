'use strict';
/** GET /v4/video/* — TopFilmes resolve MP4 a partir do link vindo do /v4/play */
const axios = require('axios');
const cheerio = require('cheerio');

const API = 4;
const BASE = (process.env.TOPFILMES_URL || 'https://topfilmes.biz').replace(/\/+$/, '');

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,*/*;q=0.8',
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
    const m = String(req.originalUrl).match(/\/v4\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

function slugFromUrl(url) {
  const m = String(url || '').match(/\/assistir\/([^/?#]+)/i) || String(url || '').match(/\/player\/([^/?#]+)/i);
  if (m) return m[1];
  if (url && !/^https?:/i.test(url) && !/[\/\s]/.test(url)) return url;
  return null;
}

async function getStream(raw) {
  if (/\.mp4(\?|$)/i.test(raw) || /\/direct\//i.test(raw)) {
    return { url: abs(BASE, raw), format: 'mp4', headers: { Referer: BASE + '/' } };
  }

  const slug = slugFromUrl(raw);
  const playerUrl = slug
    ? `${BASE}/player/${slug}?player=1`
    : raw.startsWith('http')
      ? raw
      : `${BASE}/player/${raw}?player=1`;

  const { data: html, status } = await http.get(playerUrl, {
    headers: { Referer: `${BASE}/assistir/${slug || ''}` },
  });
  if (status >= 400 || !html) return null;

  const $ = cheerio.load(html);
  let src = $('video source').attr('src') || $('source').attr('src') || null;
  if (!src) {
    const m = String(html).match(/src=["']([^"']*direct[^"']*)["']/i);
    if (m) src = m[1];
  }
  if (!src) {
    const m3 = String(html).match(/https?:\/\/[^"'\\s]+\.mp4[^"'\\s]*/i);
    if (m3) src = m3[0];
  }
  if (!src) return null;
  return { url: abs(BASE, src), format: 'mp4', headers: { Referer: BASE + '/' } };
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v4/video/' });
    const stream = await getStream(raw);
    if (!stream || !stream.url) return res.status(404).json({ success: false, error: 'Stream TopFilmes não resolvido' });
    return res.json({ success: true, api: API, source: 'topfilmes', format: stream.format || 'mp4', url: stream.url, headers: stream.headers || { Referer: BASE + '/' } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha TopFilmes video' });
  }
}

module.exports = { handler, getStream, API, source: 'topfilmes' };
