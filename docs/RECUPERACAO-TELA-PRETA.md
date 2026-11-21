# Recuperação da tela preta — TEDFLIX App V3

## Causa principal identificada

`js/app.js` importava o símbolo nomeado `GENEROS_UNIFICADOS` de `js/pages/categorias.js`, mas o módulo de categorias não exportava esse símbolo. Em módulos ES, uma importação nomeada inexistente impede a instanciação do módulo principal inteiro. O resultado é a interface não ser montada: home vazia e navegação inferior sem itens.

## Correções aplicadas

1. Exportado `GENEROS_UNIFICADOS` em `js/pages/categorias.js`, derivado da lista oficial `CATEGORIAS`.
2. Adicionada versão no import de `categorias.js` e atualizadas as versões dos arquivos CSS e do entrypoint `app.js` no `index.html`, para evitar reutilização de recursos antigos em cache.
3. Corrigido o CSS da seta de voltar: `.topbar .topbar-back[hidden]` agora realmente oculta o botão, mesmo com os estilos globais `.topbar .icon-btn` que definem `display` com `!important`.

## Arquivos alterados

- `app/src/main/assets/tedflix/js/pages/categorias.js`
- `app/src/main/assets/tedflix/js/app.js`
- `app/src/main/assets/tedflix/css/style.css`
- `app/src/main/assets/tedflix/index.html`

## Validação

- Verificada a existência de todos os imports relativos dos módulos JavaScript.
- Validada a instanciação/importação do módulo principal com Node.js após a correção.
- Não foi gerado APK neste ambiente porque o comando Gradle não está instalado e o projeto não contém `gradlew`.
