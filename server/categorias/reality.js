'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'reality',
  label: 'Reality',
  topfilmes: false,
  megacine: true,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
