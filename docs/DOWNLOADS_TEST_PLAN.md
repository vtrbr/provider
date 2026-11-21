# TEDFLIX Downloads — plano de validação em aparelho

Executar em um Android 13+ e repetir ao menos os fluxos principais em Android 10/11, se esses aparelhos fizerem parte do público.

## Fluxos funcionais

- [ ] Filme HLS/M3U8: baixar, acompanhar percentual, concluir, abrir em modo avião, avançar/retroceder.
- [ ] Filme MP4 progressivo: baixar, pausar, retomar, concluir e reproduzir offline.
- [ ] Conteúdo DASH/MPD: baixar, concluir e reproduzir offline.
- [ ] Episódio individual pelo botão na ficha da série.
- [ ] Episódio individual pela tela de informações/sinopse.
- [ ] Série completa: verificar todas as temporadas e episódios, ordem da fila e dois downloads paralelos.
- [ ] Interromper o processo durante a fila da série e abrir novamente o TEDFLIX; verificar retomada do episódio pendente.
- [ ] Voltar durante a fila e cancelar os episódios ainda não resolvidos.
- [ ] Pausar/retomar um item e pausar/retomar todos.
- [ ] Remover um item ativo e um item concluído; confirmar liberação do cache.
- [ ] Forçar falha de rede, confirmar estado Falhou, notificação e botão Tentar novamente.
- [ ] Concluir mais de um episódio e confirmar notificações individuais.
- [ ] Reproduzir offline sem token/rede, confirmar que a tela não tenta renovar o stream online.
- [ ] Confirmar que o progresso offline continua sendo salvo localmente para Continuar assistindo.
- [ ] Revogar a permissão de notificações e confirmar que os downloads continuam e a tela Meus downloads mostra o estado.

## Fontes e restrições

- Repetir os testes com cada provedor/fonte que o TEDFLIX oferece, porque cada CDN pode exigir headers, redirects e timeouts diferentes.
- Testar M3U8 VOD, MPD VOD e MP4. Conteúdo ao vivo e DRM exigem fluxos específicos e não devem ser tratados como VOD comum.
- Testar com pouco espaço livre e confirmar que a falha aparece como download com erro, sem travar o player.
- Testar com Wi-Fi e dados móveis; a política padrão do Media3 permite rede disponível, inclusive dados móveis.

## Critério de aceite

A versão só deve ser considerada validada para distribuição depois de compilar o APK em ambiente Android, instalar em aparelho real e concluir os testes acima com as fontes de vídeo efetivamente usadas pelo TEDFLIX.
