'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'faroeste',
  label: 'Faroeste',
  topfilmes: true,
  megacine: false,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
