'use strict';

/**
 * Proxy HLS (master/media playlist + segmentos)
 * Necessário porque o CDN Byse/SprintCDN assina o link pelo ASN/IP
 * de quem resolveu — no IP do usuário o m3u8 direto dá 404.
 *
 * GET /proxy/hls?u=<url-encoded>&r=<referer opcional>
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const ALLOWED_HOST_RE =
  /(sprintcdn|owphbf|r66nv9ed|bysebuho|byse\.sx|n1mwq|viewplayer|megacine|cloudfront|cdn|hls|media)/i;

function isAllowedUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ALLOWED_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

function fetchUpstream(url, headers = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(e);
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': UA,
          Accept: '*/*',
          ...headers,
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('upstream timeout'));
    });
    req.end();
  });
}

function proxyBase(req) {
  const env = (process.env.PUBLIC_API_BASE || '').replace(/\/+$/, '');
  if (env) return env;
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:1100';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function makeProxyUrl(req, targetUrl, referer) {
  const base = proxyBase(req);
  let out = `${base}/proxy/hls?u=${encodeURIComponent(targetUrl)}`;
  if (referer) out += `&r=${encodeURIComponent(referer)}`;
  return out;
}

function resolvePlaylistUrl(playlistUrl, line) {
  const t = String(line || '').trim();
  if (!t || t.startsWith('#')) return null;
  try {
    return new URL(t, playlistUrl).toString();
  } catch {
    return null;
  }
}

function rewritePlaylist(text, playlistUrl, req, referer) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // URI="..." inside tags (KEY, MAP, MEDIA, I-FRAME etc.)
    if (trimmed.startsWith('#') && /URI="/i.test(trimmed)) {
      out.push(
        trimmed.replace(/URI="([^"]+)"/gi, (_, uri) => {
          try {
            const abs = new URL(uri, playlistUrl).toString();
            return `URI="${makeProxyUrl(req, abs, referer)}"`;
          } catch {
            return `URI="${uri}"`;
          }
        })
      );
      continue;
    }

    if (trimmed.startsWith('#')) {
      out.push(line);
      continue;
    }
    if (!trimmed) {
      out.push(line);
      continue;
    }

    const abs = resolvePlaylistUrl(playlistUrl, trimmed);
    if (abs) out.push(makeProxyUrl(req, abs, referer));
    else out.push(line);
  }
  return out.join('\n');
}

function isPlaylist(contentType, url, body) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('mpegurl') || ct.includes('m3u')) return true;
  if (/\.m3u8?(\?|$)/i.test(url)) return true;
  const head = body.slice(0, 8).toString('utf8');
  return head.startsWith('#EXTM3U');
}

async function handler(req, res) {
  try {
    const q = req.query || {};
    let target = q.u || q.url || q.src || '';
    try {
      target = decodeURIComponent(String(target));
    } catch {
      target = String(target);
    }
    target = target.trim();

    if (!target) {
      return res.status(400).json({ success: false, error: 'Falta ?u=<url do stream>' });
    }
    if (!isAllowedUrl(target)) {
      return res.status(403).json({ success: false, error: 'Host não permitido no proxy' });
    }

    const referer =
      q.r ||
      q.referer ||
      'https://bysebuho.com/';

    const upstream = await fetchUpstream(target, {
      Referer: referer,
      Origin: (() => {
        try {
          return new URL(referer).origin;
        } catch {
          return 'https://bysebuho.com';
        }
      })(),
    });

    if (upstream.status >= 400) {
      return res.status(upstream.status).json({
        success: false,
        error: `Upstream HTTP ${upstream.status}`,
        url: target,
      });
    }

    const ct = upstream.headers['content-type'] || 'application/octet-stream';

    if (isPlaylist(ct, target, upstream.body)) {
      const text = upstream.body.toString('utf8');
      const rewritten = rewritePlaylist(text, target, req, referer);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(rewritten);
    }

    // segmento / key / binário
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=60');
    if (upstream.headers['content-length']) {
      res.setHeader('Content-Length', upstream.headers['content-length']);
    }
    return res.status(200).send(upstream.body);
  } catch (err) {
    console.error('[proxy/hls]', err.message);
    return res.status(500).json({ success: false, error: err.message || 'proxy falhou' });
  }
}

/** Envolve URL de stream em URL de proxy da API */
function wrapStreamUrl(req, streamUrl, referer) {
  if (!streamUrl) return streamUrl;
  if (/\/proxy\/hls\?/i.test(streamUrl)) return streamUrl;
  return makeProxyUrl(req, streamUrl, referer || 'https://bysebuho.com/');
}

module.exports = { handler, wrapStreamUrl, makeProxyUrl, isAllowedUrl };
