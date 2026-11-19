# TEDFLIX Provider v4.1

Porta **1100**. Cache catálogo **24h**. Banner **1h**.

## Subir

```bash
npm install
cp .env.example .env
npm start
```

## Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/banner` | Hero MegaCine |
| GET | `/filmes?page=1&limit=30` | Catálogo TopFilmes (todas as páginas, cache 24h) |
| GET | `/series?page=1&limit=30` | Séries MegaCine (cache 24h) |
| GET | `/filmes-novos?page=1&limit=30` | Destaques TopFilmes |
| GET | `/acao` … `/terror` | Gênero TopFilmes (scrape completo + cache 24h) |
| GET | `/categorias` | Lista de gêneros |
| GET | `/detalhe/v1/*` | Detalhe série MegaCine + temporadas/eps |
| GET | `/detalhe/v2/*` | Detalhe filme TopFilmes |
| GET | `/play/v1/*` | Stream MegaCine (byse / m3u8) |
| GET | `/play/v2/*` | Stream TopFilmes (MP4) |

`?refresh=1` força re-scrape.

### Categorias

`/acao` `/animacao` `/comedia` `/drama` `/documentario` `/fantasia` `/faroeste` `/ficcao-cientifica` `/misterio` `/nacionais` `/policial` `/romance` `/suspense` `/terror`

Aliases: `/categoria/:slug` e `/genero/:slug`.

### Exemplo play

```http
GET /play/v2/https%3A%2F%2Ftopfilmes.biz%2Fplayer%2Fmatrix%3Fplayer%3D1
GET /play/v1/https%3A%2F%2Fviewplayer.online%2Fepisodio%2F343660
GET /detalhe/v2/matrix
GET /detalhe/v1/https%3A%2F%2Fmegacine.yachts%2Fseries%2Fassistir-dexter-ressurreicao-online
```
