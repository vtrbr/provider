const https = require('https');
const http = require('http');
const { URL } = require('url');

function request(url, opts = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('URL inválida'));
    }
    const lib = u.protocol === 'http:' ? http : https;
    const headers = {
      'User-Agent':
        opts.ua ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      Accept: opts.accept || '*/*',
      ...(opts.headers || {})
    };
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: opts.method || 'GET',
        headers,
        timeout: opts.timeout || 20000
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          (opts.maxRedirects ?? 5) > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).href;
          return request(next, {
            ...opts,
            maxRedirects: (opts.maxRedirects ?? 5) - 1
          }).then(resolve, reject);
        }
        const chunks = [];
        let size = 0;
        const max = opts.maxBytes || 3 * 1024 * 1024;
        res.on('data', (c) => {
          size += c.length;
          if (size <= max) chunks.push(c);
        });
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: buffer.toString('utf8'),
            buffer,
            url: u.href
          });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function probe(url, ua, extraHeaders) {
  try {
    // aceita probe(url, { headers }) ou probe(url, ua, headers)
    let headers = {};
    let userAgent = 'ExoPlayer';
    if (ua && typeof ua === 'object') {
      headers = ua.headers || ua;
      userAgent = ua.ua || 'ExoPlayer';
    } else {
      userAgent = ua || 'ExoPlayer';
      headers = extraHeaders || {};
    }
    const r = await request(url, {
      ua: userAgent,
      headers: { Range: 'bytes=0-256', Accept: '*/*', ...headers },
      timeout: 12000,
      maxBytes: 8192
    });
    const ct = String(r.headers['content-type'] || '').toLowerCase();
    const head = r.buffer.slice(0, 32);
    const textHead = String(r.text || '').slice(0, 200).toLowerCase();
    // HTML de erro / "Nenhuma qualidade" NÃO é stream
    if (
      /nenhuma qualidade|not found|error|<!doctype html|<html/i.test(textHead) &&
      !textHead.includes('#extm3u')
    ) {
      return { ok: false, status: r.status, erro: 'corpo não é mídia', bodyPreview: textHead };
    }
    const isMp4 =
      ct.includes('mp4') || ct.includes('video') || head.includes(Buffer.from('ftyp'));
    const isHls = ct.includes('mpegurl') || r.text.includes('#EXTM3U');
    const ok =
      (r.status === 200 || r.status === 206) &&
      (isMp4 || isHls || (ct.includes('octet-stream') && r.buffer.length > 16));
    return {
      ok,
      status: r.status,
      stream_type: isHls ? 'hls' : isMp4 ? 'mp4' : 'auto',
      bodyPreview: textHead.slice(0, 80)
    };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

module.exports = { request, probe };
