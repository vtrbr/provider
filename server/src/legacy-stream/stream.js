/**
 * Donflix stream resolver — NÃO usa VidLink.
 * Cadeia: megacine → megafilmes → cineveo → pobreflix
 *
 * URLs assinadas (byse/CDN) expiram rápido → cache curto + revalidação.
 */
const cache = require('./cache');
const { resolveChain } = require('./providers');
const { maybeProxyStream } = require('./proxy');
const { request } = require('./providers/http');

/** HEAD/GET leve para ver se a URL ainda responde (não 404/410). */
async function streamStillAlive(url, headers = {}) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const r = await request(url, {
      method: 'GET',
      headers: Object.assign(
        {
          'User-Agent': 'ExoPlayer',
          Accept: '*/*',
        },
        headers || {}
      ),
      timeout: 12000,
      maxBytes: 2048,
    });
    if (r.status === 404 || r.status === 410 || r.status === 403) return false;
    if (r.status >= 400) return false;
    const body = (r.text || '').trim();
    // HTML de erro do clickhost / páginas vazias
    if (/Nenhuma qualidade|not found|error/i.test(body) && !/#EXTM3U|\.mp4|ftyp/i.test(body)) {
      return false;
    }
    // HLS ok
    if (body.includes('#EXTM3U')) return true;
    // MP4 / binário / redirect ok se status 200/206
    if (r.status === 200 || r.status === 206) return true;
    return false;
  } catch (_) {
    return false;
  }
}

async function resolveVideo({ tipo = 'serie', tmdb_id, season = 1, episode = 1 }) {
  if (!tmdb_id) throw new Error('tmdb_id obrigatório');
  const media = tipo === 'filme' || tipo === 'movie' ? 'movie' : 'tv';
  // v11: invalida cache antigo com token morto
  const cacheKey = `stream:v11:${media}:${tmdb_id}:${season}:${episode}`;
  // Tokens byse ~ poucos minutos; 90s de cache no server
  const STREAM_TTL = 90 * 1000;

  const cached = cache.get(cacheKey);
  if (cached && cached.ok && cached.stream) {
    // URL já proxied: valida o original se existir
    const checkUrl = cached.stream_original || cached.stream;
    const checkHdrs = cached.stream_original
      ? { Referer: 'https://bysebuho.com/' }
      : (cached.headers || {});
    // se já é proxy local, considera vivo (token original ainda no stream_original)
    const isOurProxy = /\/v2\/proxy\?/.test(String(cached.stream));
    if (isOurProxy && cached.stream_original) {
      const alive = await streamStillAlive(cached.stream_original, {
        Referer: 'https://bysebuho.com/',
      });
      if (alive) {
        return Object.assign({}, maybeProxyStream({
          ...cached,
          stream: cached.stream_original,
          headers: { Referer: 'https://bysebuho.com/' },
        }), { cache: 'HIT' });
      }
      cache.set(cacheKey, null, 1);
    } else if (!isOurProxy) {
      const alive = await streamStillAlive(checkUrl, checkHdrs);
      if (alive) {
        return Object.assign({}, maybeProxyStream(cached), { cache: 'HIT' });
      }
      cache.set(cacheKey, null, 1);
    }
  }

  const result = await resolveChain({
    tipo: media === 'movie' ? 'filme' : 'serie',
    tmdb_id,
    season,
    episode,
  });

  if (result && result.ok && result.stream) {
    const out = maybeProxyStream(result);
    cache.set(cacheKey, out, STREAM_TTL);
    return Object.assign({}, out, { cache: 'MISS' });
  }

  // não cacheia falha
  return Object.assign({}, result || { ok: false, erro: 'sem stream' }, { cache: 'MISS' });
}

module.exports = { resolveVideo };
