# Estrutura VIDEO E DETALHE

```
play/          ← só ficha (dados + watch)
  v1.js        /v1/play/*   megacine
  v2.js        /v2/play/*   megaflix
  v3.js        /v3/play/*   megafilmeshd1
  v4.js        /v4/play/*   topfilmes

video/         ← só stream
  v1.js        /v1/video/*  megacine
  v2.js        /v2/video/*  megaflix
  v3.js        /v3/video/*  megafilmeshd1
  v4.js        /v4/video/*  topfilmes
  
```

O que cada um faz



PastaDevolveplay/título, ano, capa, sinopse, type, watch, e se série: seasons[].episodes[].watchvideo/{ format, url, headers } do stream
O watch do play já vem montado:

https://api.tedflix.site/vN/video/{url_bruta}

Uso no Express

JavaScriptapp.get('/v1/play/*', require('./play/v1').handler);
app.get('/v1/video/*', require('./video/v1').handler);
// ... v2 v3 v4
