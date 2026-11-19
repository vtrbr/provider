'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'comedia',
  label: 'Comédia',
  topfilmes: true,
  megacine: true,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
