/**
 * Cadeia Donflix — 4 provedores que devolvem stream
 * 1) megacine.yachts     (viewplayer → byse → m3u8) — prioritário, estável
 * 2) megafilmeshd1.com  (clickhost / comprarebom)
 * 3) cineveo.cfd        (timeout curto se cair)
 * 4) pobreflixtv.business
 */
const cineveo = require('./cineveo');
const megafilmes = require('./megafilmes');
const megacine = require('./megacine');
const pobreflix = require('./pobreflix');
const streamberry = require('./streamberry');
const sites_extra = require('./sites_extra');
const tmdb = require('../../services/tmdb.service');

/** Cadeia unificada — usados por Donflix e como fallback dos outros servers */
const ORDER = [
  { name: 'megacine', fn: megacine.resolve },
  { name: 'streamberry', fn: streamberry.resolve },
  { name: 'megafilmes', fn: megafilmes.resolve },
  { name: 'cineveo', fn: cineveo.resolve },
  { name: 'pobreflix', fn: pobreflix.resolve },
  { name: 'sites_extra', fn: sites_extra.resolve }
];

async function metaFor(tmdb_id, media) {
  try {
    const d = await tmdb.getById(media === 'movie' ? 'movie' : 'series', tmdb_id);
    return {
      title: d.titulo || d.titulo_original || d.title || d.name || null,
      year: String(d.ano || d.year || '').slice(0, 4),
      imdb_id: d.imdb_id || d.external_ids?.imdb_id || d.imdbId || null,
    };
  } catch (_) {
    return { title: null, year: null, imdb_id: null };
  }
}

async function resolveChain({ tipo, tmdb_id, season = 1, episode = 1 }) {
  const media = tipo === 'filme' || tipo === 'movie' ? 'movie' : 'tv';
  const meta = await metaFor(tmdb_id, media);
  const title = meta.title || String(tmdb_id);
  const tried = [];

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(label + ' timeout ' + ms + 'ms')), ms)
      )
    ]);
  }

  for (const p of ORDER) {
    const started = Date.now();
    try {
      const timeoutMs = p.name === 'cineveo' ? 12000 : 25000;
      const r = await withTimeout(
        p.fn({
          title,
          tmdb_id,
          media,
          season,
          episode,
          imdb_id: meta.imdb_id
        }),
        timeoutMs,
        p.name
      );
      tried.push({
        provider: r.provider || p.name,
        ok: !!r.ok,
        ms: Date.now() - started,
        erro: r.ok ? null : r.erro || null
      });
      if (r && r.ok && r.stream) {
        // revalida mídia (bloqueia "Nenhuma qualidade" / HTML)
        try {
          const { probe } = require('./http');
          const pr = await probe(r.stream, {
            headers: r.headers || {},
            ua: 'ExoPlayer'
          });
          if (!pr.ok) {
            tried[tried.length - 1].ok = false;
            tried[tried.length - 1].erro = pr.erro || 'probe stream inválido';
            continue;
          }
          if (pr.stream_type && pr.stream_type !== 'auto') {
            r.stream_type = pr.stream_type;
          }
        } catch (_) {}
        return {
          ok: true,
          media: media === 'movie' ? 'filme' : 'serie',
          tmdb_id: parseInt(tmdb_id, 10),
          season: media === 'tv' ? parseInt(season, 10) : null,
          episode: media === 'tv' ? parseInt(episode, 10) : null,
          title,
          stream: r.stream,
          stream_type: r.stream_type || 'mp4',
          quality: r.quality || null,
          headers: r.headers && Object.keys(r.headers).length ? r.headers : {},
          provider: r.provider || p.name,
          playback: {
            user_agent: 'ExoPlayer',
            apply_headers: !!(r.headers && Object.keys(r.headers).length),
            forbid_referer: !(r.headers && r.headers.Referer),
            note:
              r.stream_type === 'hls'
                ? 'HlsMediaSource'
                : 'ProgressiveMediaSource (mp4)'
          },
          captions: Array.isArray(r.captions) ? r.captions : [],
          idioma: 'DUB',
          tried
        };
      }
    } catch (e) {
      tried.push({
        provider: p.name,
        ok: false,
        ms: Date.now() - started,
        erro: e.message || String(e)
      });
    }
  }

  return {
    ok: false,
    erro: 'nenhum provedor devolveu stream',
    tmdb_id: parseInt(tmdb_id, 10),
    media: media === 'movie' ? 'filme' : 'serie',
    title,
    tried
  };
}

module.exports = { resolveChain, ORDER };
