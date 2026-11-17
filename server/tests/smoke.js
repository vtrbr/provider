'use strict';

const assert = require('node:assert/strict');
const { createContentService } = require('../src/services/content.service');

async function run() {
  const calls = [];
  const providers = {
    get(api) {
      if (api === 'v1') return {
        getContent: async (id) => ({
          success: true,
          api: 'v1',
          id,
          type: 'series',
          title: 'The Example Show',
          year: 2024,
          playable: true,
          identifiers: { sourceId: id },
          seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1, title: 'Pilot' }] }],
        }),
        play: async (id, season, episode) => {
          calls.push({ action: 'v1.play', id, season, episode });
          return { success: true, api: 'v1', playback: { format: 'hls', url: 'https://example.invalid/video.m3u8' } };
        },
        capabilities: () => ({ capabilities: { playback: true } }),
      };
      if (api === 'v2') return {
        getContent: async (id) => ({ success: true, api: 'v2', id, type: 'movie', title: 'No Player', playable: false, identifiers: { sourceId: id } }),
        play: async () => ({ success: false, api: 'v2', error: { code: 'PLAYER_UNSTABLE' } }),
      };
      if (api === 'v4') return {
        getContent: async (id) => ({ success: true, api: 'v4', id, type: 'movie', title: 'Example Film', identifiers: { sourceId: id, tmdbId: '123' } }),
        playByTmdb: async (tmdbId, type) => ({ success: true, api: 'v4', contentId: tmdbId, type, playback: { format: 'mp4', url: 'https://example.invalid/video.mp4' } }),
      };
      if (api === 'v5') return {
        getContent: async (id) => ({ success: true, api: 'v5', id, type: 'movie', title: 'Example Film', identifiers: { sourceId: id } }),
        play: async (id) => ({ success: true, api: 'v5', contentId: id, playback: { format: 'mp4', url: 'https://example.invalid/video.mp4' } }),
      };
      if (api === 'v3') return {
        getAgenda: async () => ({ success: true, api: 'v3', source: 'megacine_calendar_widget', days: [{ date: '2026-11-16', label: 'Segunda-feira', items: [{ api: 'v3', type: 'series', sourceId: 'example-show', title: 'The Example Show', season: 1, episode: 2, episodeLabel: 'T1E2', timeLabel: '21:00' }] }] }),
      };
      return null;
    },
  };
  const tmdb = {
    getById: async (type, id) => ({
      ok: true,
      tmdb_id: Number(id),
      tipo: type === 'series' ? 'serie' : 'filme',
      titulo: type === 'series' ? 'The Example Show' : 'Example Film',
      titulo_original: type === 'series' ? 'The Example Show' : 'Example Film',
      ano: 2024,
      capa: 'https://image.invalid/poster.jpg',
      backdrop: 'https://image.invalid/backdrop.jpg',
      sinopse: 'Synopsis',
      nota: 8.2,
      generos: ['Drama'],
      temporadas: type === 'series' ? 1 : null,
      episodios: type === 'series' ? 1 : null,
      temporadas_lista: type === 'series' ? [{ numero: 1, nome: 'Season 1', episodios: [{ tmdb_id: 10, numero: 1, titulo: 'Pilot', sinopse: 'Pilot synopsis' }] }] : [],
    }),
    enrichByTitle: async (title, type) => ({ ok: true, tmdb_id: 123, tipo: type === 'series' ? 'serie' : 'filme', titulo: title, titulo_original: title, ano: 2024, capa: 'https://image.invalid/agenda.jpg', backdrop: 'https://image.invalid/agenda-bg.jpg', sinopse: 'Agenda synopsis', nota: 8.1, temporadas_lista: [{ numero: 1, episodios: [{ numero: 1, titulo: 'Pilot' }, { numero: 2, titulo: 'Second Episode', sinopse: 'Episode synopsis', imagem: 'https://image.invalid/still.jpg', nota: 8.5 }] }] }),
  };

  const streamCalls = [];
  const service = createContentService({ providers, tmdb, streamResolver: async (args) => { streamCalls.push(args); return { ok: true, stream: 'https://media.invalid/video.m3u8', stream_type: 'hls', provider: 'megacine', headers: { Referer: 'https://viewplayer.online/' }, tried: [{ provider: 'megacine', ok: true }] }; } });

  const details = await service.getDetails('v1', 'source-42', { type: 'series' });
  assert.equal(details.success, true);
  assert.equal(details.content.title, 'The Example Show');
  assert.equal(details.content.seasons[0].episodes[0].video_path, '/api/play/v1/source-42?type=series&season=1&episode=1');
  assert.equal(details.tmdb.matched, true);

  const playback = await service.play('v1', 'source-42', { type: 'series', season: 1, episode: 1 });
  assert.equal(playback.success, true);
  assert.equal(playback.api, 'tmdb-chain');
  assert.deepEqual(streamCalls[0], { tipo: 'serie', tmdb_id: '123', season: 1, episode: 1 });

  const megaFilmes = await service.play('v4', 'example-film', { type: 'movie' });
  assert.equal(megaFilmes.success, true);
  assert.equal(megaFilmes.contentId, '123');

  const superflix = await service.play('v2', 'no-player', { type: 'movie' });
  assert.equal(superflix.success, true);
  assert.equal(superflix.api, 'tmdb-chain');

  const unsupportedSeries = await service.play('v5', 'only-movie', { type: 'series', season: 1, episode: 1 });
  assert.equal(unsupportedSeries.success, true);
  assert.equal(unsupportedSeries.api, 'tmdb-chain');

  const agenda = await service.getAgenda({ days: 14 });
  assert.equal(agenda.success, true);
  assert.equal(agenda.days[0].items[0].tmdbId, 123);
  assert.equal(agenda.days[0].items[0].episodeTitle, 'Second Episode');
  assert.equal(agenda.days[0].items[0].playPath, '/api/play/v3/example-show?type=series&season=1&episode=2');

  const unknown = await service.getDetails('v99', 'x');
  assert.equal(unknown.success, false);
  assert.equal(unknown.error.code, 'SOURCE_NOT_FOUND');

  console.log('TEDFLIX smoke tests: 7 passed (TMDB resolver chain + agenda)');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
