'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'misterio',
  label: 'Mistério',
  topfilmes: true,
  megacine: false,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
