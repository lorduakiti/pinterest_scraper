# CLAUDE.md

Orientações para o Claude Code neste repositório.

## Visão geral

Script CLI único em Node.js ([_pinterest_scraper_image_like.js](_pinterest_scraper_image_like.js))
que, via `puppeteer-core` controlando o Chrome instalado, baixa a imagem principal de Pins do
Pinterest (nomeada pelo título) e reage com ♥. Tem modo de Pin único e modo lista (`.txt`).
[pinterest-links-txt.skill](pinterest-links-txt.skill) é uma skill do Claude in Chrome que gera
esses `.txt` a partir das abas de um grupo; ela usa ferramentas do claude.ai, não do Claude Code.

### Dois scripts durante a comparação Puppeteer × Playwright

[_pinterest_scraper_image_like_pw.js](_pinterest_scraper_image_like_pw.js) é uma cópia com a camada
de navegador trocada por `playwright-core`. As diferenças ficam em `getBrowser`, `gotoPage`/`openPin`,
`firstVisible`/`appeared`, `isLoggedIn`, `loginPinterest`, `reactWithHeart` e no fechamento em `main`.
**Mudanças de lógica comum** (argumentos, cores, barra, log, `-c`, resumo, download)
**precisam ser feitas nos dois arquivos** até um deles ser removido. No Playwright, não use
`waitUntil: 'networkidle'` no `goto` (pode nunca chegar no Pinterest); `waitForLoadState('networkidle')`
só com `timeout` curto e `.catch`, como em `waitReactionState`.

## Comandos

```bash
npm install                                          # puppeteer-core e playwright-core
node --check _pinterest_scraper_image_like.js        # checagem de sintaxe
node _pinterest_scraper_image_like.js --help         # ajuda (gerada do comentário do topo)
node _test_validate.js --help                        # teste de ponta a ponta (ver abaixo)
```

Não há build, testes unitários nem linter. [_test_validate.js](_test_validate.js) roda o scraper de
verdade com uma lista (padrão `_pinterest.txt` → `./imgs`) e valida saída, resumo, imagens, log,
reexecução e `-c`. **Ele usa a conta do Pinterest e reage aos Pins**: só rode com pedido do usuário
(`--no-like` evita reações; `--skip-run` só valida a pasta). Saídas de teste (`imgs/`, `imgs_pw/`) estão no `.gitignore`.
Antes de validar ele chama [_test_reset.js](_test_reset.js) (pule com `--no-reset`): apaga as imagens da pasta, esvazia o
log e **remove as reações** dos Pins da lista. O reset só clica com `aria-pressed="true"` estável (nunca adiciona
reação) e recusa pastas fora do projeto ou a raiz dele. Também é destrutivo: só com pedido do usuário.

## Arquitetura (ordem no arquivo)

1. Argumentos (`parseArgs`) e `printHelp`, que imprime o bloco `/** ... */` do topo do arquivo.
   **Ao mudar opções ou comportamento, atualize esse comentário** (e o README).
2. Cores (`palette`, `logError`): ANSI só em TTY, respeitando `NO_COLOR`/`FORCE_COLOR`.
   `OUT` é para stdout (`console.log`), `ERR` para stderr (`console.error`/`warn`).
3. Utilitários: nomes de arquivo, leitura da lista, `linkKey` (compara links pelo ID do Pin) e
   log de downloads `_pinterest_claude_download.txt`, gravado **na pasta de destino**.
4. Browser: `getBrowser` conecta ao Chrome em `CHROME_DEBUG_URL` (9222) ou abre um com perfil `./.pinterest-profile`.
5. Passos por Pin: `openPin` → `isLoggedIn`/`loginPinterest` → `getMainImage` → `download` → `reactWithHeart`,
   orquestrados em `processPin`. `openPin` (idêntico nos dois scripts) navega com `domcontentloaded` e
   valida o carregamento com `missingParts`: espera `LOAD_DELAY_MS` (1 s), depois até `LOAD_EXTRA_MS` (5 s),
   senão `reload` — até `LOAD_ATTEMPTS` (3) e então lança "Link quebrado". Só o botão "Reagir" faltando
   (exigido com like) não quebra o link. Redirecionamento para fora de um Pin falha na hora, sem refresh.
6. `createProgress`: barra fixa na última linha. Ela substitui `console.log/warn/error`
   enquanto está ativa (apaga a barra, escreve, redesenha); `stop()` restaura os originais.
   Escreva sempre via `console.*`, nunca com `process.stdout.write` direto durante o loop, senão a barra se mistura ao texto.
7. `checkLists` (`-c`): modo só leitura. Compara as listas `_pinterest*.txt` (ou o arquivo de `-l`)
   com o log via `linkKey` e imprime um resumo por arquivo, reaproveitando `row`. Roda no início de
   `main` e retorna antes de qualquer acesso ao navegador. Nunca adicione escrita ou rede a esse modo.
8. `printSummary` e `main`. No modo lista, cada Pin tem seu próprio `try/catch`: o erro vai para
   `errors` e o loop continua. A exceção é o navegador desconectado, que aborta. `report()` (idempotente)
   encerra a barra, grava o log e imprime o resumo, tanto no `finally` quanto no Ctrl+C.

## Convenções

- CommonJS, Node 18+, sem dependências além de `puppeteer-core`/`playwright-core`; prefira APIs nativas do Node.
- Mensagens, comentários e documentação em **português (pt-BR)**.
- Ícones: `✓` verde (sucesso), `✗` vermelho (erro); mensagens de erro via `logError`
  (fundo vermelho, letra amarela). Saída precisa funcionar no PowerShell do Windows 11 e em terminais Unix.
  **Não use `✔` (U+2714) nem `✖` (U+2716)**: o Windows Terminal os desenha como emoji
  colorido (roxo) e ignora a cor ANSI. `✓`/`✗` são símbolos de texto e aceitam cor.
- Seções separadas por comentários `// ----- nome`; JSDoc curto em português nas funções.

## Cuidados

- Seletores do Pinterest (`data-test-id`, `aria-label` em pt/en) mudam com frequência; quando algo
  "não é encontrado", o mais provável é seletor desatualizado.
- O arquivo `.txt` de entrada nunca é alterado; só o log na pasta de destino recebe links (append, sem duplicar).
  Pins com erro não entram no log, para serem tentados de novo.
- Clicar em "Reagir" num Pin já reagido **desfaz** a reação; mantenha a checagem de `aria-pressed`.
  O Pinterest desenha o botão com `aria-pressed="false"` e só depois aplica a reação da conta:
  ler cedo demais desfez reações reais num teste (Playwright). Por isso existem `waitReactionState`
  (Playwright) e, nos dois scripts, a trava que clica de novo quando o contador **cai** após o clique.
- Não faça commit de `.pinterest-profile/` (sessão/cookies do navegador) nem de credenciais.
  Prefira `PINTEREST_USER`/`PINTEREST_PASS` a `-P`.
- Não rode o script contra o Pinterest real sem pedir ao usuário: ele usa a conta dele e reage a Pins.
