'use strict';

/**
 * Normalize a catalog/search card to the TEDFLIX contract.
 */
function card(item, api) {
  return {
    id: String(item.id || item.sourceId || item.slug || ''),
    api,
    sourceId: item.sourceId != null ? String(item.sourceId) : String(item.id || ''),
    sourceSlug: item.sourceSlug || item.slug || null,
    type: item.type || 'unknown', // movie | series | unknown
    title: item.title || null,
    originalTitle: item.originalTitle || null,
    year: item.year != null ? Number(item.year) : null,
    poster: item.poster || null,
    backdrop: item.backdrop || null,
    overview: item.overview || item.description || null,
    rating: item.rating != null ? Number(item.rating) : null,
    genres: Array.isArray(item.genres) ? item.genres : [],
    runtime: item.runtime != null ? Number(item.runtime) : null,
    playable: item.playable !== false,
    tmdbId: item.tmdbId || null,
    imdbId: item.imdbId || null,
  };
}

function detail(item, api) {
  return {
    success: true,
    api,
    id: String(item.id || item.sourceId || ''),
    type: item.type || 'unknown',
    title: item.title || null,
    originalTitle: item.originalTitle || null,
    year: item.year != null ? Number(item.year) : null,
    poster: item.poster || null,
    backdrop: item.backdrop || null,
    overview: item.overview || null,
    rating: item.rating != null ? Number(item.rating) : null,
    runtime: item.runtime != null ? Number(item.runtime) : null,
    genres: Array.isArray(item.genres) ? item.genres : [],
    cast: Array.isArray(item.cast) ? item.cast : [],
    director: Array.isArray(item.director) ? item.director : (item.director ? [item.director] : []),
    playable: item.playable !== false,
    identifiers: {
      sourceId: item.sourceId != null ? String(item.sourceId) : String(item.id || ''),
      sourceSlug: item.sourceSlug || item.slug || null,
      sourcePostId: item.sourcePostId || null,
      tmdbId: item.tmdbId || null,
      imdbId: item.imdbId || null,
    },
    seasons: item.seasons || undefined,
  };
}

function playback(result, api) {
  return {
    success: true,
    api,
    contentId: result.contentId || null,
    type: result.type || 'movie',
    playback: {
      format: result.format || 'unknown', // hls | mp4 | mkv | embed
      url: result.url || null,
      headers: result.headers || {},
      subtitles: result.subtitles || [],
      expiresAt: result.expiresAt || null,
      quality: result.quality || null,
    },
  };
}

function pagination(meta = {}) {
  return {
    currentPage: meta.currentPage || 1,
    totalPages: meta.totalPages || null,
    limit: meta.limit || null,
    hasNext: meta.hasNext != null ? meta.hasNext : null,
    hasPrevious: meta.hasPrevious != null ? meta.hasPrevious : null,
    totalResults: meta.totalResults || null,
  };
}

function error(api, code, message, extra = {}) {
  return {
    success: false,
    api: api || null,
    error: {
      code,
      message,
      ...extra,
    },
  };
}

module.exports = { card, detail, playback, pagination, error };
