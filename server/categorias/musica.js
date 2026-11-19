'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'musica',
  label: 'Música',
  topfilmes: false,
  megacine: true,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
