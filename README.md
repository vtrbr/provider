# TEDFLIX Provider — TopFilmes

Porta **1100**. Cache catálogo **24h**.

## Subir

```bash
npm install
npm start
```

## Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/filmes?page=1&limit=30` | Catálogo TopFilmes |
| GET | `/filmes-novos?page=1&limit=30` | Destaques / lançamentos TopFilmes |
| GET | `/acao` … `/terror` | Gênero TopFilmes |
| GET | `/categorias` | Lista de gêneros |
| GET | `/detalhe/v2/*` | Detalhe filme TopFilmes + players (fonte) |
| GET | `/play/v2/*` | Stream TopFilmes (MP4) |

`?refresh=1` força re-scrape.

Aliases de categoria: `/categoria/:slug` e `/genero/:slug`.

### Exemplos

```http
GET /filmes?page=1&limit=30
GET /filmes-novos
GET /acao
GET /detalhe/v2/matrix
GET /play/v2/https%3A%2F%2Ftopfilmes.biz%2Fplayer%2Fmatrix%3Fplayer%3D1
GET /play/v2/matrix?player=1
```
