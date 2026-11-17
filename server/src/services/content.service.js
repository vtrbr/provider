'use strict';

const { error } = require('../lib/normalize');

function normalizeType(type) {
  const value = String(type || '').toLowerCase();
  if (['series', 'serie', 'tv', 'tvshow'].includes(value)) return 'series';
  if (['movie', 'filme', 'movies'].includes(value)) return 'movie';
  return null;
}

function isError(value) {
  return !value || value.success === false || value.ok === false;
}

function providerDetail(provider, api, id, type) {
  if (api === 'v1') return provider.getContent(id);
  if (api === 'v2') return provider.getContent(id, type || 'movie');
  if (api === 'v3') return provider.getContent(id, type || 'movie');
  if (api === 'v4') return provider.getContent(id, type || 'movie');
  if (api === 'v5') return provider.getContent(id);
  return null;
}

function mapEpisode(episode, api, sourceId, seasonNumber, canPlay, tmdbEp) {
  const episodeNumber = Number(
    episode.numero ?? episode.episode_number ?? episode.episodeNumber ?? episode.number
  ) || null;
  const videoPath = canPlay && episodeNumber
    ? `/api/play/${api}/${encodeURIComponent(sourceId)}?type=series&season=${Number(seasonNumber)}&episode=${episodeNumber}`
    : null;
  return {
    tmdbId: tmdbEp?.tmdb_id || episode.tmdb_id || episode.id || null,
    episodeNumber,
    title: tmdbEp?.titulo || episode.titulo || episode.name || episode.title || (episodeNumber ? `Episódio ${episodeNumber}` : null),
    originalTitle: episode.titulo_original || episode.name || null,
    overview: tmdbEp?.sinopse || episode.sinopse || episode.overview || null,
    airDate: tmdbEp?.data_lancamento || episode.data_lancamento || episode.air_date || null,
    year: episode.ano || null,
    runtime: tmdbEp?.duracao_min || episode.duracao_min || episode.runtime || null,
    rating: tmdbEp?.nota ?? episode.nota ?? episode.vote_average ?? null,
    still: tmdbEp?.imagem || episode.imagem || episode.still || null,
    video_path: videoPath,
  };
}

function canResolve(api) {
  return ['v1', 'v2', 'v3', 'v4', 'v5'].includes(api);
}

function indexTmdbEpisodes(tmdb) {
  const map = new Map();
  const seasons = Array.isArray(tmdb?.temporadas_lista) ? tmdb.temporadas_lista : [];
  for (const season of seasons) {
    const sn = Number(season.numero ?? season.seasonNumber) || 0;
    for (const ep of season.episodios || season.episodes || []) {
      const en = Number(ep.numero ?? ep.episode_number ?? ep.episodeNumber) || 0;
      if (sn && en) map.set(`${sn}:${en}`, ep);
    }
  }
  return map;
}

function mapContent(tmdb, source, api, sourceId, type, matchScore) {
  // Oferece play se a fonte permite OU se temos TMDB (cadeia) OU é filme com id
  const canPlay = canResolve(api) && (
    source.playable !== false
    || !!(tmdb && (tmdb.tmdb_id || tmdb.id))
    || type === 'movie'
    || (type === 'series' && Array.isArray(source.seasons) && source.seasons.length > 0)
  ) && !(api === 'v5' && type === 'series');
  const sourceSeasons = Array.isArray(source.seasons) ? source.seasons : [];
  const tmdbSeasons = Array.isArray(tmdb?.temporadas_lista) ? tmdb.temporadas_lista : [];
  const tmdbEpIndex = indexTmdbEpisodes(tmdb);

  // Prefer SOURCE seasons (real play structure). Fall back to TMDB only if source has none.
  const seasonsInput = sourceSeasons.length ? sourceSeasons : tmdbSeasons;

  const seasons = type === 'series'
    ? seasonsInput.map((season) => {
        const seasonNumber = Number(season.numero ?? season.seasonNumber) || 0;
        const episodes = (season.episodios || season.episodes || []).map((ep) => {
          const en = Number(ep.numero ?? ep.episode_number ?? ep.episodeNumber ?? ep.number) || 0;
          const tmdbEp = tmdbEpIndex.get(`${seasonNumber}:${en}`) || null;
          return mapEpisode(ep, api, sourceId, seasonNumber, canPlay, tmdbEp);
        });
        return {
          tmdbId: season.tmdb_id || season.tmdbId || null,
          seasonNumber,
          title: season.nome || season.name || season.title || `Temporada ${seasonNumber}`,
          overview: season.sinopse || season.overview || null,
          airDate: season.data_lancamento || season.air_date || null,
          poster: season.capa || season.poster || null,
          episodeCount: season.total_episodios ?? episodes.length,
          episodes,
        };
      })
    : undefined;

  const tmdbGenres = Array.isArray(tmdb?.generos) ? tmdb.generos : [];
  const sourceGenres = Array.isArray(source.genres) ? source.genres.map((g) => g.name || g) : [];

  // Only trust TMDB title when match is solid; otherwise keep source title.
  const trustTmdb = !!tmdb && (matchScore == null || matchScore >= 0.55);
  const sourceLabel = displaySourceTitle(source);
  const title = trustTmdb
    ? (tmdb.titulo || tmdb.titulo_original || (sourceLabel !== 'Título não identificado' ? sourceLabel : sourceLabel))
    : (sourceLabel !== 'Título não identificado'
        ? sourceLabel
        : (tmdb?.titulo || tmdb?.titulo_original || sourceLabel));

  const content = {
    tmdbId: trustTmdb ? (tmdb?.tmdb_id || source.identifiers?.tmdbId || null) : (source.identifiers?.tmdbId || null),
    imdbId: trustTmdb ? (tmdb?.imdb_id || source.identifiers?.imdbId || null) : (source.identifiers?.imdbId || null),
    type,
    title,
    originalTitle: trustTmdb ? (tmdb?.titulo_original || source.originalTitle || null) : (source.originalTitle || tmdb?.titulo_original || null),
    year: (trustTmdb && tmdb?.ano) || source.year || null,
    releaseDate: trustTmdb ? (tmdb?.data_lancamento || null) : null,
    rating: trustTmdb ? (tmdb?.nota ?? source.rating ?? null) : (source.rating ?? tmdb?.nota ?? null),
    votes: trustTmdb ? (tmdb?.votos || null) : null,
    poster: (trustTmdb && tmdb?.capa) || source.poster || tmdb?.capa || null,
    backdrop: (trustTmdb && tmdb?.backdrop) || source.backdrop || source.poster || tmdb?.backdrop || null,
    overview: (trustTmdb && tmdb?.sinopse) || source.overview || tmdb?.sinopse || null,
    genres: tmdbGenres.length && trustTmdb ? tmdbGenres : sourceGenres,
    runtime: (trustTmdb && tmdb?.duracao_min) || source.runtime || null,
    director: trustTmdb ? (tmdb?.diretor || source.director || null) : (source.director || null),
    cast: trustTmdb && Array.isArray(tmdb?.elenco) ? tmdb.elenco : (source.cast || []),
    status: trustTmdb ? (tmdb?.status || null) : null,
    seasons,
    totalSeasons: seasons ? seasons.length : (trustTmdb ? tmdb?.temporadas || null : null),
    totalEpisodes: seasons ? seasons.reduce((n, s) => n + (s.episodes?.length || 0), 0) : (trustTmdb ? tmdb?.episodios || null : null),
  };

  const titleQs = content.title && content.title !== 'Título não identificado'
    ? `&title=${encodeURIComponent(content.title)}`
    : '';
  const yearQs = content.year ? `&year=${encodeURIComponent(content.year)}` : '';
  const moviePath = type === 'movie' && canPlay
    ? `/api/play/${api}/${encodeURIComponent(sourceId)}?type=movie${titleQs}${yearQs}`
    : null;

  return {
    content,
    source: {
      api,
      id: String(sourceId),
      slug: source.identifiers?.sourceSlug || source.identifiers?.sourceId || String(sourceId),
      type: source.type || type,
      playable: canPlay,
      identifiers: source.identifiers || {},
    },
    playback: {
      supported: canPlay,
      reason: canPlay ? null : 'NOT_PLAYABLE',
      video_path: moviePath,
      episode_path: type === 'series' && canPlay
        ? `/api/play/${api}/${encodeURIComponent(sourceId)}?type=series&season={season}&episode={episode}${titleQs}`
        : null,
    },
  };
}

function tmdbIdFromSource(source) {
  const id = source?.identifiers?.tmdbId || source?.tmdbId || null;
  if (id == null || id === '') return null;
  return String(id);
}

function sourceTitle(source, fallbackTitle) {
  const candidates = [source?.title, source?.originalTitle, source?.identifiers?.sourceSlug, fallbackTitle, source?.slug];
  return candidates.find((value) => value != null && String(value).trim() && !/^\d+$/.test(String(value).trim())) || null;
}

function displaySourceTitle(source) {
  const value = sourceTitle(source, null);
  if (!value) return 'Título não identificado';
  return String(value).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sourceYear(source, fallbackYear) {
  return source?.year || fallbackYear || null;
}

function titleOfTmdb(tmdb) {
  return tmdb?.titulo || tmdb?.match?.titulo || tmdb?.match?.title || null;
}

function titleSimilarity(a, b) {
  const norm = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xs = new Set(x.split(' ').filter(Boolean));
  const ys = new Set(y.split(' ').filter(Boolean));
  if (!xs.size || !ys.size) return 0;
  // Contenção só conta se a diferença de tokens for pequena (evita Matrix ≈ Threat Matrix)
  if (x.includes(y) || y.includes(x)) {
    const shorter = xs.size <= ys.size ? xs : ys;
    const longer = xs.size > ys.size ? xs : ys;
    if ([...shorter].every((t) => longer.has(t)) && longer.size - shorter.size <= 1) return 0.95;
  }
  const intersection = [...xs].filter((t) => ys.has(t)).length;
  return (2 * intersection) / (xs.size + ys.size);
}

/**
 * Aceita match TMDB só se título (e tipo/ano quando disponíveis) forem compatíveis.
 */
function validateEnrichment(tmdb, title, year, sourceType) {
  if (!tmdb || tmdb.ok !== true) return false;

  const tmdbType = normalizeType(tmdb.tipo || tmdb.match?.tipo || tmdb.type);
  if (sourceType && tmdbType && sourceType !== tmdbType) return false;

  const candidates = [tmdb.titulo, tmdb.titulo_original, tmdb.match?.titulo, tmdb.match?.titulo_original]
    .filter(Boolean);
  if (!candidates.length) return false;
  if (!title) return false;

  const score = Math.max(...candidates.map((candidate) => titleSimilarity(title, candidate)));
  const tmdbYear = Number(tmdb.ano || tmdb.match?.ano) || null;
  const wantedYear = Number(year) || null;

  // Título muito diferente → rejeita
  if (score < 0.55) return false;

  // Ano diverge demais com score só mediano → rejeita
  if (wantedYear && tmdbYear && Math.abs(wantedYear - tmdbYear) > 1 && score < 0.85) return false;

  return true;
}

function enrichmentScore(tmdb, title) {
  if (!tmdb || !title) return null;
  const candidates = [tmdb.titulo, tmdb.titulo_original, tmdb.match?.titulo, tmdb.match?.titulo_original]
    .filter(Boolean);
  if (!candidates.length) return null;
  return Math.max(...candidates.map((c) => titleSimilarity(title, c)));
}

function createContentService(options = {}) {
  const providers = options.providers || require('../providers');
  const tmdb = options.tmdb || require('./tmdb.service');
  const streamResolver = options.streamResolver || ((args) => require('../legacy-stream/stream').resolveVideo(args));

  async function getDetails(api, id, query = {}) {
    const provider = providers.get(api);
    if (!provider) return error(api, 'SOURCE_NOT_FOUND', `Provider desconhecido: ${api}`);
    if (!id) return error(api, 'INVALID_PARAMETERS', 'source id obrigatório');

    const hint = normalizeType(query.type);
    let source;
    try {
      source = await providerDetail(provider, api, id, hint);
    } catch (e) {
      return error(api, 'SOURCE_DETAIL_FAILED', e.message || String(e));
    }
    if (isError(source)) return source || error(api, 'NOT_FOUND', 'Conteúdo não encontrado na fonte');

    // Tipo da FONTE manda; TMDB nunca troca filme↔série
    const type = normalizeType(source.type) || hint || 'movie';
    // Prioriza título/ano vindos do app (card) quando a fonte não devolve
    if (query.title && (!source.title || !String(source.title).trim() || /^\d+$/.test(String(source.title).trim()))) {
      source = { ...source, title: String(query.title).trim() };
    }
    if (query.year && !source.year) {
      source = { ...source, year: Number(query.year) || null };
    }
    const title = sourceTitle(source, query.title);
    const year = sourceYear(source, query.year);
    let meta = null;
    let tmdbError = null;
    const knownTmdbId = tmdbIdFromSource(source);

    try {
      if (knownTmdbId) {
        meta = await tmdb.getById(type, knownTmdbId);
        // Se o tipo do meta não bate com a fonte, descarta
        if (meta && normalizeType(meta.tipo) && normalizeType(meta.tipo) !== type) {
          tmdbError = { code: 'TMDB_TYPE_MISMATCH', message: 'TMDB retornou tipo diferente da fonte.' };
          meta = null;
        }
      }
    } catch (e) {
      tmdbError = { code: e.code || 'TMDB_LOOKUP_FAILED', message: e.message || String(e) };
    }

    if (!meta && title) {
      try {
        const enriched = await tmdb.enrichByTitle(title, type, year);
        if (validateEnrichment(enriched, title, year, type)) {
          meta = enriched;
          tmdbError = null;
        } else {
          tmdbError = {
            code: 'TMDB_MATCH_UNCERTAIN',
            message: 'O resultado do TMDB não foi associado com segurança ao título da fonte.',
            attempted: enriched?.titulo || enriched?.match?.titulo || null,
            score: enrichmentScore(enriched, title),
          };
        }
      } catch (e) {
        tmdbError = { code: e.code || 'TMDB_ENRICH_FAILED', message: e.message || String(e) };
      }
    }

    const matchScore = meta && title ? enrichmentScore(meta, title) : (meta ? 1 : null);
    const mapped = mapContent(meta, source, api, id, type, matchScore);
    const matchTitle = titleOfTmdb(meta);

    return {
      success: true,
      api,
      content: mapped.content,
      source: mapped.source,
      playback: mapped.playback,
      tmdb: {
        matched: !!meta,
        id: meta?.tmdb_id || null,
        title: matchTitle,
        matchScore,
        error: tmdbError,
      },
    };
  }

  async function getAgenda(query = {}) {
    const provider = providers.get('v3');
    if (!provider || typeof provider.getAgenda !== 'function') {
      return error('v3', 'AGENDA_UNAVAILABLE', 'O provider MegaCine não oferece agenda.');
    }

    let agenda;
    try {
      agenda = await provider.getAgenda();
    } catch (e) {
      return error('v3', 'AGENDA_UPSTREAM_ERROR', e.message || String(e));
    }

    const unique = new Map();
    for (const day of agenda.days || []) {
      for (const item of day.items || []) {
        const key = String(item.title || item.sourceId || '').toLowerCase().trim();
        if (key && !unique.has(key)) unique.set(key, item);
      }
    }

    const metadata = new Map();
    const entries = [...unique.entries()];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, entries.length) }, async () => {
      while (cursor < entries.length) {
        const index = cursor++;
        const [key, item] = entries[index];
        if (item.type !== 'series' || !item.title) continue;
        try {
          const enriched = await tmdb.enrichByTitle(item.title, 'series', item.year);
          if (validateEnrichment(enriched, item.title, item.year, 'series')) {
            metadata.set(key, enriched);
          }
        } catch (_) {}
      }
    });
    await Promise.all(workers);

    const days = (agenda.days || []).map((day) => ({
      ...day,
      items: (day.items || []).map((item) => {
        const key = String(item.title || item.sourceId || '').toLowerCase().trim();
        const meta = metadata.get(key);
        if (!meta) return item;
        const sn = Number(item.season) || 0;
        const en = Number(item.episode) || 0;
        let episodeMeta = null;
        for (const season of meta.temporadas_lista || []) {
          const sNum = Number(season.numero ?? season.seasonNumber) || 0;
          if (sNum !== sn) continue;
          for (const ep of season.episodios || season.episodes || []) {
            if (Number(ep.numero ?? ep.episode_number ?? ep.episodeNumber) === en) {
              episodeMeta = ep;
              break;
            }
          }
        }
        return {
          ...item,
          tmdbId: meta.tmdb_id || item.tmdbId || null,
          poster: meta.capa || item.poster || null,
          backdrop: meta.backdrop || item.backdrop || null,
          overview: episodeMeta?.sinopse || meta.sinopse || item.overview || null,
          rating: episodeMeta?.nota ?? meta.nota ?? item.rating ?? null,
          year: meta.ano || item.year || null,
          episodeTitle: episodeMeta?.titulo || item.episodeTitle || null,
          episodeStill: episodeMeta?.imagem || item.episodeStill || null,
          episodeOverview: episodeMeta?.sinopse || item.episodeOverview || null,
          contentPath: item.contentPath || `/api/content/v3/${encodeURIComponent(item.sourceId || item.id)}?type=series&title=${encodeURIComponent(item.title || '')}`,
          playPath: item.playPath || (item.season && item.episode
            ? `/api/play/v3/${encodeURIComponent(item.sourceId || item.id)}?type=series&season=${item.season}&episode=${item.episode}`
            : null),
        };
      }),
    }));

    return {
      success: true,
      api: 'v3',
      source: 'megacine',
      title: agenda.title || 'Agenda',
      updatedAt: agenda.updatedAt || new Date().toISOString(),
      days,
      totalItems: days.reduce((n, d) => n + (d.items?.length || 0), 0),
      tmdbEnriched: true,
    };
  }

  async function play(api, id, query = {}) {
    const provider = providers.get(api);
    if (!provider) return error(api, 'SOURCE_NOT_FOUND', `Provider desconhecido: ${api}`);
    if (!id) return error(api, 'INVALID_PARAMETERS', 'source id obrigatório');

    const type = normalizeType(query.type) || 'movie';
    const season = Number(query.season) || 1;
    const episode = Number(query.episode) || 1;
    let title = query.title || null;
    let year = query.year || null;

    let tmdbId = query.tmdbId || query.tmdb_id || null;
    let source = null;

    try {
      source = await providerDetail(provider, api, id, type);
      if (!isError(source)) {
        tmdbId = tmdbId || tmdbIdFromSource(source);
        title = title || sourceTitle(source, null);
        year = year || sourceYear(source, null);
      }
    } catch (_) {}

    if (!tmdbId && title) {
      try {
        const match = await tmdb.enrichByTitle(title, type, year);
        if (validateEnrichment(match, title, year, type)) tmdbId = match.tmdb_id || match.id || null;
      } catch (_) {}
    }

    // Cadeia original por TMDB id (legacy-stream) quando disponível
    if (tmdbId) {
      try {
        const resolved = await streamResolver({
          tipo: type === 'series' ? 'serie' : 'filme',
          tmdb_id: String(tmdbId),
          season,
          episode,
        });
        if (resolved?.ok && resolved.stream) {
          const format = String(resolved.stream_type || (/\.m3u8(?:$|\?)/i.test(resolved.stream) ? 'hls' : 'mp4')).toLowerCase();
          return {
            success: true,
            api: 'tmdb-chain',
            contentId: String(tmdbId),
            type,
            title: resolved.title || title || null,
            provider: resolved.provider || null,
            tried: resolved.tried || [],
            playback: {
              format: format === 'm3u8' ? 'hls' : format,
              url: resolved.stream,
              headers: resolved.headers || {},
              subtitles: resolved.captions || [],
              quality: resolved.quality || null,
              expiresAt: null,
            },
          };
        }
        if (resolved && Array.isArray(resolved.tried)) {
          // tmdb-chain falhou → cai no provider direto abaixo
        }
      } catch (_) {}
    }

    try {
      let result;
      if (api === 'v1') result = await provider.play(id, season, episode);
      else if (api === 'v2') result = await provider.play(id, season, episode);
      else if (api === 'v3') result = type === 'series' ? await provider.playSeriesEpisode(id, season, episode) : await provider.play(id);
      else if (api === 'v4') {
        const resolvedTmdbId = tmdbId || (source && !isError(source) ? tmdbIdFromSource(source) : null);
        if (!resolvedTmdbId) return error(api, 'TMDB_ID_REQUIRED', 'Não foi possível associar este título ao TMDB.');
        result = await provider.playByTmdb(
          resolvedTmdbId,
          type === 'series' ? 'serie' : 'filme',
          type === 'series' ? season : '',
          type === 'series' ? episode : ''
        );
      } else if (api === 'v5') {
        if (type === 'series') return error(api, 'SERIES_NOT_SUPPORTED', 'TopFilmes não possui reprodução de séries própria.');
        result = await provider.play(id, Number.parseInt(query.player, 10) || 1);
      }
      if (!result) return error(api, 'PLAYBACK_UNAVAILABLE', 'A fonte não retornou um resultado de reprodução.');
      return result;
    } catch (e) {
      return error(api, 'PLAYBACK_FAILED', e.message || String(e));
    }
  }

  return { getDetails, play, getAgenda };
}

module.exports = { createContentService, normalizeType, canResolve };
