# TEDFLIX App — integração com Content Server v2

## Base URL

O cliente JavaScript e o player Android usam `https://api.tedflix.site` como base do Content Server.

## Rotas usadas pelo app

| Uso | Método e rota |
|---|---|
| Saúde | `GET /health` e `GET /api/health` |
| Lista de fontes | `GET /api/sources` |
| Pesquisa agregada | `GET /api/search?q={termo}&type=all&page=1` |
| Catálogo de filmes | `GET /api/catalog/movies?page=1` |
| Catálogo de séries | `GET /api/catalog/series?page=1` |
| Gêneros/categorias | `GET /api/categories` |
| Ficha do conteúdo + TMDB | `GET /api/content/{api}/{sourceId}?type=movie` ou `type=series` |
| Resolver filme | `GET /api/play/{api}/{sourceId}?type=movie` |
| Resolver episódio | `GET /api/play/{api}/{sourceId}?type=series&season={n}&episode={n}` |

O identificador `sourceId` continua identificando o card/provider. Ao solicitar reprodução, o Content Server recupera o TMDB ID associado e executa a cadeia original de resolvedores do servidor TEDAUTH. O app não escolhe nem concatena links de vídeo.

## Códigos dos providers

- `v1`: MegaFlix
- `v2`: Superflix
- `v3`: MegaCine
- `v4`: MegaFilmesHD1
- `v5`: TopFilmes

Os cinco códigos de catálogo podem acionar a cadeia central por TMDB quando a ficha foi associada corretamente. A cadeia tenta, na ordem original: MegaCine, Streamberry, MegaFilmes, Cineveo, Pobreflix e sites_extra. Se nenhum devolver uma URL de mídia válida, o servidor retorna os diagnósticos de cada tentativa; não inventa link.

## Responsabilidades mantidas separadas

- `login.tedflix.site`: autenticação, perfis, conta, progresso e operações do usuário.
- `v6-tedtop.onrender.com`: integração TEDTOP independente.
- `pluto.tedflix.site`: integração Pluto TV independente.
- Content Server v2: pesquisa, catálogo, detalhes TMDB e resolução de streams dos providers `v1` a `v5`.

O app não consulta o helper TMDB diretamente. A cadeia de reprodução e os extratores originais ficam no servidor.


## Agenda de episódios

O aplicativo consulta `GET /api/agenda?days=14` no Content Server v2. O servidor obtém o cronograma do widget AJAX do MegaCine (v3) e enriquece cada série/episódio com os metadados disponíveis no serviço TMDB. O app não chama o TMDB diretamente.

Os cards de episódios abrem a ficha do episódio com `serieCategoria=v3`, o `serieSlug` original e os números de temporada/episódio. A reprodução continua usando `/api/play/v3/:sourceId?type=series&season=:season&episode=:episode`.

## Cadeia original de reprodução restaurada

Os módulos de extração `megacine.js`, `streamberry.js`, `megafilmes.js`, `cineveo.js`, `pobreflix.js`, `sites_extra.js` e `http.js` foram copiados byte a byte da pasta `shared-stream/providers` do servidor TEDAUTH original. A adaptação está limitada ao adaptador TMDB e ao proxy público do novo domínio. O HLS usa `GET /v2/proxy?url=...&ref=...`; configure `CONTENT_PUBLIC_URL` se o domínio público do Content Server não for `https://api.tedflix.site`.
