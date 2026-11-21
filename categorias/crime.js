'use strict';

const { createGenre } = require('../lib/topfilmes-genre');

const catalog = createGenre({
  slug: 'crime',
  label: 'Crime',
  topfilmes: false,
  megacine: false,
});

module.exports = { handler: catalog.handler, getAll: catalog.getAll };
