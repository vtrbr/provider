# TEDFLIX Provider — TopFilmes only (fonte + player)

Porta **1100**.

## Rotas

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/detalhe/v2/*` | Detalhe filme TopFilmes + lista de players (fonte) |
| GET | `/play/v2/*` | Resolve player TopFilmes → MP4 final |

`?refresh=1` força re-scrape.

### Exemplos

```http
GET /detalhe/v2/matrix
GET /detalhe/v2/https%3A%2F%2Ftopfilmes.biz%2Fassistir%2Fmatrix
GET /play/v2/https%3A%2F%2Ftopfilmes.biz%2Fplayer%2Fmatrix%3Fplayer%3D1
GET /play/v2/matrix?player=1
```

## Subir

```bash
npm install
npm start
```
