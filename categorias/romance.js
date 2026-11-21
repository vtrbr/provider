'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'romance',
  label: 'Romance',
  topfilmes: true,
  megacine: false,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
