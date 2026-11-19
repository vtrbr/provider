'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'faroeste',
  label: 'Faroeste',
  topfilmes: true,
  megacine: true,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
