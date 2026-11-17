'use strict';
/** GET /v1/video/* — MegaCine resolve stream a partir do link vindo do /v1/play */
const axios = require('axios');
const cheerio = require('cheerio');

const API = 1;
const BASE = (process.env.MEGACINE_URL || 'https://megacine.yachts').replace(/\/+$/, '');
const VIEWPLAYER = 'https://viewplayer.online';
const BYSE_API = 'https://bysebuho.com';

const http = axios.create({
  timeout: Number(process.env.PROVIDER_TIMEOUT_MS) || 25000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/json,*/*;q=0.8',
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
    const m = String(req.originalUrl).match(/\/v1\/video\/(.+?)(?:\?|$)/i);
    if (m) raw = m[1];
  }
  return decodeURIComponent(String(raw || '').trim());
}

async function resolveByse(embedUrl) {
  const m = String(embedUrl || '').match(/\/e\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  try {
    const { data, status } = await http.get(`${BYSE_API}/api/videos/${m[1]}`, {
      headers: { Referer: 'https://bysebuho.com/', Origin: 'https://bysebuho.com', Accept: 'application/json' },
    });
    if (status >= 400 || !data) return null;
    const src =
      data.source || data.file || data.url || data.stream ||
      (Array.isArray(data.sources) && data.sources[0] && (data.sources[0].file || data.sources[0].src));
    if (!src) return null;
    return { url: String(src), format: /\.m3u8/i.test(src) ? 'hls' : 'mp4', headers: { Referer: 'https://bysebuho.com/' } };
  } catch {
    return null;
  }
}

function extractSources(html) {
  const $ = cheerio.load(html || '');
  const out = [];
  $('iframe[src], source[src], video[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) out.push(src);
  });
  const found = String(html).match(/https?:\/\/[^"'\\s]+/gi) || [];
  for (const u of found) {
    if (/\.m3u8|\.mp4|bysebuho|\/e\//i.test(u)) out.push(u);
  }
  return [...new Set(out.map((s) => abs(VIEWPLAYER, s)).filter(Boolean))];
}

async function getStream(raw) {
  if (/\.m3u8(\?|$)/i.test(raw) || /\.mp4(\?|$)/i.test(raw)) {
    return { url: raw, format: /\.m3u8/i.test(raw) ? 'hls' : 'mp4', headers: { Referer: VIEWPLAYER + '/' } };
  }
  if (/bysebuho|\/e\//i.test(raw)) {
    const byse = await resolveByse(raw);
    if (byse) return byse;
  }
  const { data: html, status } = await http.get(raw, { headers: { Referer: BASE + '/' } });
  if (status >= 400 || !html) return null;
  for (const src of extractSources(html)) {
    if (/bysebuho|\/e\//i.test(src)) {
      const byse = await resolveByse(src);
      if (byse) return byse;
    }
    if (/\.m3u8/i.test(src)) return { url: src, format: 'hls', headers: { Referer: VIEWPLAYER + '/' } };
    if (/\.mp4/i.test(src)) return { url: src, format: 'mp4', headers: { Referer: VIEWPLAYER + '/' } };
  }
  return null;
}

async function handler(req, res) {
  try {
    const raw = rawFromReq(req);
    if (!raw) return res.status(400).json({ success: false, error: 'URL ausente após /v1/video/' });
    const stream = await getStream(raw);
    if (!stream || !stream.url) return res.status(404).json({ success: false, error: 'Stream MegaCine não resolvido' });
    return res.json({ success: true, api: API, source: 'megacine', format: stream.format || 'hls', url: stream.url, headers: stream.headers || {} });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message || 'Falha MegaCine video' });
  }
}

module.exports = { handler, getStream, API, source: 'megacine' };
