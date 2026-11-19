'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'animacao',
  label: 'Animação',
  topfilmes: true,
  megacine: true,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
