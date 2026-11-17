/**
 * Proxy HLS/CDN — tokens byse amarrados ao ASN do server.
 * O app só fala com a API; a API busca no CDN com o IP certo.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const PUBLIC_BASE = String(process.env.PUBLIC_BASE || process.env.CONTENT_PUBLIC_URL || 'https://api.tedflix.site').replace(/\/+$/, '');

function proxyUrl(target, ref) {
  const q = new URLSearchParams();
  q.set('url', target);
  if (ref) q.set('ref', ref);
  return `${PUBLIC_BASE}/v2/proxy?${q.toString()}`;
}

/** Reescreve playlist m3u8 para passar segmentos pelo proxy. */
function rewriteM3u8(body, baseUrl, ref) {
  const lines = String(body).split(/\r?\n/);
  return lines
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) {
        // URI="..." em EXT-X-KEY / I-FRAME
        if (/URI="/i.test(line)) {
          return line.replace(/URI="([^"]+)"/gi, (_, u) => {
            try {
              const abs = new URL(u, baseUrl).href;
              return `URI="${proxyUrl(abs, ref)}"`;
            } catch {
              return `URI="${u}"`;
            }
          });
        }
        return line;
      }
      try {
        const abs = new URL(t, baseUrl).href;
        return proxyUrl(abs, ref);
      } catch {
        return line;
      }
    })
    .join('\n');
}

/**
 * Se o stream for HLS de CDN assinado (byse/sprintcdn), devolve URL do proxy.
 * MP4 direto (pobreflix/clickhost) permanece como está.
 */
function maybeProxyStream(result) {
  if (!result || !result.ok || !result.stream) return result;
  const u = String(result.stream);
  const isHls =
    result.stream_type === 'hls' ||
    result.stream_type === 'm3u8' ||
    /\.m3u8(\?|$)/i.test(u);
  const needsProxy =
    isHls &&
    (/sprintcdn|r66nv9ed|bysebuho|viewplayer|megacine/i.test(u) ||
      result.provider === 'megacine');
  if (!needsProxy) return result;

  const ref =
    (result.headers && (result.headers.Referer || result.headers.referer)) ||
    'https://bysebuho.com/';

  const proxied = proxyUrl(u, ref);
  return Object.assign({}, result, {
    stream: proxied,
    stream_original: u,
    stream_type: 'hls',
    headers: {}, // app → API: sem Referer especial
    proxied: true,
    playback: Object.assign({}, result.playback || {}, {
      user_agent: 'ExoPlayer',
      apply_headers: false,
      forbid_referer: true,
      note: 'HlsMediaSource via /v2/proxy (ASN do server)',
    }),
  });
}

/**
 * Handler HTTP GET /v2/proxy?url=&ref=
 */
function handleProxy(req, res, u) {
  const target = u.searchParams.get('url') || u.searchParams.get('u');
  const ref = u.searchParams.get('ref') || 'https://bysebuho.com/';
  if (!target || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, erro: 'url inválida' }));
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, erro: 'url inválida' }));
    return;
  }

  const lib = parsed.protocol === 'http:' ? http : https;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    Accept: '*/*',
    Referer: ref,
    Origin: ref.replace(/\/$/, ''),
  };

  const upstream = lib.request(
    {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers,
      timeout: 45000,
    },
    (up) => {
      // redirects
      if (
        up.statusCode >= 300 &&
        up.statusCode < 400 &&
        up.headers.location
      ) {
        up.resume();
        const next = new URL(up.headers.location, target).href;
        const q = new URLSearchParams({ url: next, ref });
        res.writeHead(302, {
          Location: `${PUBLIC_BASE}/v2/proxy?${q.toString()}`,
          'Access-Control-Allow-Origin': '*',
        });
        res.end();
        return;
      }

      const ct = String(up.headers['content-type'] || '');
      const isPlaylist =
        /\.m3u8(\?|$)/i.test(parsed.pathname) ||
        /mpegurl|m3u8/i.test(ct);

      if (isPlaylist) {
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (up.statusCode >= 400) {
            res.writeHead(up.statusCode || 502, {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(
              JSON.stringify({
                ok: false,
                erro: 'upstream ' + up.statusCode,
                preview: body.slice(0, 200),
              })
            );
            return;
          }
          const rewritten = rewriteM3u8(body, target, ref);
          const out = Buffer.from(rewritten, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
            'Content-Length': out.length,
          });
          res.end(out);
        });
        return;
      }

      // segmentos .ts / binário — pipe
      const outHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60',
      };
      if (up.headers['content-type'])
        outHeaders['Content-Type'] = up.headers['content-type'];
      else if (/\.ts(\?|$)/i.test(parsed.pathname))
        outHeaders['Content-Type'] = 'video/mp2t';
      if (up.headers['content-length'])
        outHeaders['Content-Length'] = up.headers['content-length'];
      if (up.headers['content-range'])
        outHeaders['Content-Range'] = up.headers['content-range'];
      if (up.headers['accept-ranges'])
        outHeaders['Accept-Ranges'] = up.headers['accept-ranges'];

      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
    }
  );

  upstream.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: false, erro: e.message || 'proxy error' }));
    } else {
      res.end();
    }
  });
  upstream.on('timeout', () => {
    upstream.destroy();
    if (!res.headersSent) {
      res.writeHead(504, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ ok: false, erro: 'proxy timeout' }));
    }
  });
  upstream.end();
}

module.exports = { handleProxy, maybeProxyStream, proxyUrl, PUBLIC_BASE };
