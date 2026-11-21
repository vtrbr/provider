# TEDFLIX — Offline-first e perfis locais

## O que foi alterado

- A inicialização usa os perfis previamente sincronizados no armazenamento privado do Android e abre o seletor sem aguardar a API.
- Se o aparelho estiver sem conectividade validada, a seleção do perfil é feita localmente. Com internet, a seleção remota e a validação de acesso continuam sendo executadas.
- Falha de rede durante a seleção permite fallback para o perfil local. Respostas HTTP de autorização/negação não são ignoradas.
- Os perfis continuam armazenados em SharedPreferences privados, com o token associado cifrado pelo Android Keystore; a seleção ativa também é persistida localmente.
- O cache persistente de catálogo passa a usar stale-while-revalidate: dados já armazenados são devolvidos imediatamente, mesmo vencidos, enquanto uma atualização de rede ocorre em segundo plano. Se a atualização falhar, o cache local continua disponível.
- As operações protegidas continuam exigindo token válido. O modo offline não simula autenticação, não ignora bloqueios de conta e não permite ações remotas sem rede.

## Correções Kotlin

- Imports explícitos de `org.json.JSONObject` em `PlayerActivity.kt` e `TedflixDownloadService.kt`.
- `DownloadIndex.getDownloads` recebe máscara de estado `0` em vez de `IntArray`.
- Tipo de `id` explicitado como `String` no fluxo de resolução do download para evitar inferência ambígua.

## Limites e validação pendente

- O primeiro login e o primeiro carregamento de perfis ainda exigem internet; não existe perfil local antes da primeira autenticação/sincronização.
- Catálogo, detalhes, favoritos e histórico só podem mostrar offline o que já tiver sido carregado e persistido no dispositivo. Conteúdo não baixado não pode ser reproduzido sem rede.
- A validação de conectividade usa `NET_CAPABILITY_VALIDATED`; captive portals e redes sem acesso à internet serão tratados como offline.
- Foram executados `node --check` nos 40 arquivos JavaScript e parse do AndroidManifest XML. Não há Android SDK/Gradle neste ambiente, então não foi possível executar `:app:compileDebugKotlin`, gerar APK ou testar em aparelho. A confirmação final de compilação ainda depende de build Android real.
