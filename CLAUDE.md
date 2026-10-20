# CLAUDE.md

Orientações para o Claude Code neste repositório.

## Visão geral

Script CLI único em Node.js ([_pinterest_scraper_image_like.js](_pinterest_scraper_image_like.js))
que, via `puppeteer-core` controlando o Chrome instalado, baixa a imagem principal de Pins do
Pinterest (nomeada pelo título) e reage com ♥. Tem modo de Pin único e modo lista (`.txt`).
[pinterest-links-txt.skill](pinterest-links-txt.skill) é uma skill do Claude in Chrome que gera
esses `.txt` a partir das abas de um grupo; ela usa ferramentas do claude.ai, não do Claude Code.

## Comandos

```bash
npm install                                          # única dependência: puppeteer-core
node --check _pinterest_scraper_image_like.js        # checagem de sintaxe
node _pinterest_scraper_image_like.js --help         # ajuda (gerada do comentário do topo)
```

Não há build, testes automatizados nem linter.

## Arquitetura (ordem no arquivo)

1. Argumentos (`parseArgs`) e `printHelp`, que imprime o bloco `/** ... */` do topo do arquivo.
   **Ao mudar opções ou comportamento, atualize esse comentário** (e o README).
2. Cores (`palette`, `logError`): ANSI só em TTY, respeitando `NO_COLOR`/`FORCE_COLOR`.
   `OUT` é para stdout (`console.log`), `ERR` para stderr (`console.error`/`warn`).
3. Utilitários: nomes de arquivo, leitura da lista, `linkKey` (compara links pelo ID do Pin) e
   log de downloads `_pinterest_claude_download.txt`, gravado **na pasta de destino**.
4. Browser: `getBrowser` conecta ao Chrome em `CHROME_DEBUG_URL` (9222) ou abre um com perfil `./.pinterest-profile`.
5. Passos por Pin: `isLoggedIn`/`loginPinterest` → `getMainImage` → `download` → `reactWithHeart`,
   orquestrados em `processPin`.
6. `createProgress`: barra fixa na última linha. Ela substitui `console.log/warn/error`
   enquanto está ativa (apaga a barra, escreve, redesenha); `stop()` restaura os originais.
   Escreva sempre via `console.*`, nunca com `process.stdout.write` direto durante o loop, senão a barra se mistura ao texto.
7. `printSummary` e `main`. No modo lista, cada Pin tem seu próprio `try/catch`: o erro vai para
   `errors` e o loop continua. A exceção é o navegador desconectado, que aborta. `report()` (idempotente)
   encerra a barra, grava o log e imprime o resumo, tanto no `finally` quanto no Ctrl+C.

## Convenções

- CommonJS, Node 18+, sem dependências além de `puppeteer-core`; prefira APIs nativas do Node.
- Mensagens, comentários e documentação em **português (pt-BR)**.
- Ícones: `✔` verde (sucesso), `✖` vermelho (erro); mensagens de erro via `logError`
  (fundo vermelho, letra amarela). Saída precisa funcionar no PowerShell do Windows 11 e em terminais Unix.
- Seções separadas por comentários `// ----- nome`; JSDoc curto em português nas funções.

## Cuidados

- Seletores do Pinterest (`data-test-id`, `aria-label` em pt/en) mudam com frequência; quando algo
  "não é encontrado", o mais provável é seletor desatualizado.
- O arquivo `.txt` de entrada nunca é alterado; só o log na pasta de destino recebe links (append, sem duplicar).
  Pins com erro não entram no log, para serem tentados de novo.
- Clicar em "Reagir" num Pin já reagido **desfaz** a reação; mantenha a checagem de `aria-pressed`.
- Não faça commit de `.pinterest-profile/` (sessão/cookies do navegador) nem de credenciais.
  Prefira `PINTEREST_USER`/`PINTEREST_PASS` a `-P`.
- Não rode o script contra o Pinterest real sem pedir ao usuário: ele usa a conta dele e reage a Pins.
