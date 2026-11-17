# TEDFLIX Content Server — v2

Servidor unificado de catálogo, detalhes e reprodução para os cinco providers. O TMDB é consultado internamente para metadados; os IDs originais dos providers continuam sendo usados para localizar os vídeos.

## Fluxo do aplicativo

1. O app pesquisa em `GET /api/search?q=...` ou carrega um catálogo em `GET /api/catalog/movies` / `GET /api/catalog/series`.
2. Cada card retorna `api` e `sourceId`. O app deve guardar os dois valores sem substituir `sourceId` pelo ID do TMDB.
3. Ao abrir um card, chama `GET /api/content/:api/:sourceId?type=movie|series`. O servidor busca a ficha no provider, consulta o TMDB por ID quando disponível ou por título/tipo/ano e devolve uma resposta unificada.
4. Para filme, o app usa `playback.video_path`. Para série, usa `video_path` de cada episódio ou monta o `playback.episode_path` substituindo `{season}` e `{episode}`.
5. O servidor resolve a URL real apenas em `GET /api/play/:api/:sourceId?...`, quando o usuário aperta Assistir/Continuar. Não tenta resolver todos os episódios durante a abertura da ficha.

## Rotas públicas

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Estado do servidor |
| GET | `/api/health` | Estado, providers e cache |
| GET | `/api/sources` | Lista de providers |
| GET | `/api/sources/:api` | Capacidades de um provider |
| GET | `/api/search?q=&type=&page=` | Pesquisa unificada (`movie`, `series` ou `all`) |
| GET | `/api/catalog/movies?page=&category=` | Catálogo de filmes |
| GET | `/api/catalog/series?page=&category=` | Catálogo de séries |
| GET | `/api/categories` | Gêneros disponíveis |
| GET | `/api/content/:api/:sourceId?type=` | Ficha unificada + metadados TMDB |
| GET | `/api/play/:api/:sourceId?type=&season=&episode=` | Resolve a reprodução sob demanda |

Os endpoints antigos duplicados `/api/v1/...`, `/api/v2/...` etc. foram removidos do servidor principal. O app deve usar as rotas unificadas acima. O código de cada provider continua separado em `src/providers/`.

## Providers e capacidade real

- `v1` MegaFlix: busca, catálogo, filmes, séries, temporadas/episódios e resolução pelo ID próprio do MegaFlix.
- `v2` Superflix: busca, catálogo e detalhes. O player permanece marcado como instável; a rota `/api/play/v2/...` devolve `PLAYER_UNSTABLE` em vez de inventar uma URL.
- `v3` MegaCine: busca, catálogo, detalhes, temporadas/episódios e resolução pelo slug próprio (filmes podem usar IMDb internamente).
- `v4` MegaFilmesHD1: busca, detalhes e resolução por TMDB ID obtido da ficha do próprio provider.
- `v5` TopFilmes: busca, catálogo, detalhes e resolução de filmes. Séries não são anunciadas como suportadas.

Uma resposta do TMDB não é considerada uma URL de vídeo. O TMDB fornece os metadados e a estrutura de temporadas/episódios; o provider continua responsável por resolver o stream.

## Configuração

Node.js >= 18.

```bash
npm install
cp .env.example .env
npm start
```

Configuração principal em `.env`:

```env
PORT=8080
HOST=0.0.0.0
SEARCH_TIMEOUT_MS=12000
TMDB_API_URL=https://tmdb.tedflix.site
TMDB_TIMEOUT_MS=15000

MEGAFLIX_URL=https://megaflix.live
SUPERFLIX_URL=https://superflix.best
MEGACINE_URL=https://megacine.yachts
MEGAFILMES_URL=https://megafilmeshd1.com
TOPFILMES_URL=https://topfilmes.biz
```

Não coloque a chave do TMDB neste servidor de conteúdo. A chave continua somente no `.env` do serviço TMDB que já faz a formatação dos metadados.

## Exemplos

```bash
curl "http://localhost:8080/api/search?q=matrix&type=movie"
curl "http://localhost:8080/api/content/v1/14550?type=movie"
curl "http://localhost:8080/api/play/v1/14550?type=movie"
curl "http://localhost:8080/api/content/v3/slug-da-serie?type=series"
curl "http://localhost:8080/api/play/v3/slug-da-serie?type=series&season=1&episode=1"
```

## Testes

```bash
npm test
```

Os testes automatizados verificam o contrato unificado com providers/TMDB simulados. Eles não substituem testes ao vivo dos sites de origem. A resolução real depende da disponibilidade e das respostas atuais de cada provider.


## Agenda de episódios

`GET /api/agenda?days=14` consulta o widget AJAX `megacine_calendar_widget` do MegaCine (provider `v3`) e enriquece os títulos/episódios com os metadados do serviço TMDB configurado em `TMDB_API_URL`/`TMDB_BASE_URL`. O aplicativo consome somente esta rota; não chama o MegaCine nem o TMDB diretamente.

Cada item inclui `api`, `sourceId`, `title`, `season`, `episode`, `episodeLabel`, `time`, `timeLabel`, `tmdbId`, `poster`, `backdrop`, `episodeTitle`, `episodeStill`, `contentPath` e `playPath` quando a temporada/episódio foi identificado. A reprodução continua usando o ID/slug original do MegaCine.


## Reprodução original TEDAUTH restaurada

O fluxo `/api/play/:api/:sourceId` resolve o TMDB ID associado ao conteúdo e usa a cadeia original copiada de `shared-stream/providers`: MegaCine → Streamberry → MegaFilmes → Cineveo → Pobreflix → sites_extra. Os extratores dos providers foram copiados sem alteração; somente o adaptador de metadados foi ligado ao microserviço `TMDB_API_URL`.

O proxy HLS original está disponível em `/v2/proxy`. Configure `CONTENT_PUBLIC_URL` com a URL pública deste serviço para gerar links absolutos; o padrão é `https://api.tedflix.site`. Também foram mantidos aliases de compatibilidade `/v2/video/filme/:tmdbId`, `/v2/video/serie/:tmdbId/:season/:episode`, `/v2/filme/:tmdbId`, `/v2/serie/:tmdbId`, `/v2/title` e `/v2/calendar`.
