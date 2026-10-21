# pinterest_scraper

Baixa imagens de Pins do Pinterest com Node.js + Puppeteer, nomeando cada arquivo
pelo título da imagem, e reage com ♥ ao Pin após o download.

## Funcionalidades

- Verifica se você está logado no Pinterest (login automático opcional, com suporte a CAPTCHA/2FA manual).
- Encontra a imagem principal do Pin e baixa na maior resolução disponível (`/originals/` quando existe).
- Nomeia o arquivo pelo título da imagem → título da página → nome original, sem sobrescrever arquivos existentes.
- Reage com coração após o download e confirma se a reação foi registrada (não desfaz reações existentes).
- **Modo lista**: processa um `.txt` com um link por linha, com delay entre os Pins.
  - Um erro em um Pin **não interrompe** a lista; o Pin com erro é tentado de novo na próxima execução.
  - **Carregamento verificado**: após abrir o Pin, espera 1 s; se a página estiver incompleta (documento,
    imagem do Pin e, com like, o botão "Reagir"), espera até mais 5 s; senão recarrega e repete. Após
    3 tentativas o link é considerado **quebrado** (conta como erro).
  - Links já baixados (registrados em `_pinterest_claude_download.txt` na pasta de destino) são ignorados.
  - **Barra de progresso fixa** na última linha do terminal.
  - **Resumo final**: total da lista, baixadas, já baixadas anteriormente, erros (e não processadas, se interrompido).
- **Modo validação** (`-c`): confere se os links das listas `_pinterest*.txt` já foram todos baixados, sem abrir o navegador nem baixar nada.

## Requisitos

- Node.js 18+
- Google Chrome instalado (o projeto usa `puppeteer-core`, que não baixa navegador)

```bash
npm install
```

Se o Chrome estiver em um caminho fora do padrão, defina `CHROME_PATH`:

```powershell
$env:CHROME_PATH="D:\Apps\Chrome\chrome.exe"
```

## Uso

```bash
node _pinterest_scraper_image_like.js [opções]
```

| Opção | Descrição |
|---|---|
| `-d, --dir <pasta>` | Pasta de destino (se omitida, é perguntada no terminal) |
| `-l, --list <arq.txt>` | Arquivo `.txt` com um link de Pin por linha (linhas com `#` são ignoradas) |
| `-t, --delay <seg>` | Delay entre os Pins da lista (padrão: `1`) |
| `-u, --url <link>` | Baixa um Pin específico |
| `--no-like` | Não reage com coração |
| `-U, --user <email>` | Usuário do Pinterest, para login automático |
| `-P, --pass <senha>` | Senha (se omitida, é pedida sem aparecer na tela) |
| `-c, --check` | Só valida se os links já constam no log de downloads (veja abaixo) |
| `-h, --help` | Ajuda |

Sem `-l` nem `-u`, o script usa a aba de Pin que já estiver aberta no Chrome.

### Exemplos

```powershell
# Lista de links, 2,5 s entre os Pins
node _pinterest_scraper_image_like.js -d "C:\Imagens\Pinterest" -l links.txt -t 2.5

# Um Pin específico, sem reagir
node _pinterest_scraper_image_like.js -d .\img -u https://br.pinterest.com/pin/123456789/ --no-like

# Login automático com credenciais em variáveis de ambiente (não ficam no histórico)
$env:PINTEREST_USER="seu@email.com"; $env:PINTEREST_PASS="suaSenha"
node _pinterest_scraper_image_like.js -d .\img -l links.txt
```

### Saída do modo lista

```
[3/10] https://br.pinterest.com/pin/123456789/
  Título da imagem: Sala com plantas
  ✓ Salva: C:\Imagens\Pinterest\Sala_com_plantas.jpg (resolução original)
  ♥ Reação de coração aplicada e confirmada
[███████░░░░░░░░░░░░░░░░] 3/10  30% │ ✓ 3  ✗ 0 │ 00:41 · faltam ~01:35

━━━━━━━━━━━━━━━ Resumo ━━━━━━━━━━━━━━━
  Total de imagens da lista ....   12
  Baixadas nesta execução ......    9
  Já baixadas anteriormente ....    2
  Erros ........................    1
```

O código de saída é `1` quando há erros, o que permite usar o script em automações.

### Modo validação (`-c`)

Confere se os links das listas temporárias já estão no `_pinterest_claude_download.txt`
da pasta. **Não abre o navegador, não baixa e não altera nenhum arquivo.**

```powershell
# Todos os _pinterest*.txt da pasta (o próprio log é ignorado)
node _pinterest_scraper_image_like.js -c -d "C:\Imagens\Pinterest"

# Um arquivo específico (sem -d, usa o log da pasta do arquivo)
node _pinterest_scraper_image_like.js -c -l "C:\Imagens\Pinterest\_pinterest_claude_20261018-17-19.txt"
```

Para cada arquivo, mostra o total da lista, quantos já foram baixados e quantos estão pendentes, com
os links que faltam. Com mais de um arquivo, mostra também um resumo geral:

```
━━━━━━━ Validação: _pinterest_claude_20261019-09-00.txt ━━━━━━━
  Total de imagens da lista ....    3
  Já baixadas ..................    1
  Pendentes ....................    2
  ✗ Faltam 2 link(s):
     - https://br.pinterest.com/pin/333/
     - https://br.pinterest.com/pin/444/
```

O código de saída é `0` quando tudo já foi baixado e `1` quando há pendências ou erro.

## Conexão com o navegador

Tentada automaticamente, nesta ordem:

1. **Chrome já aberto com depuração remota**, reaproveitando a sessão e as abas:
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-scraper"
   ```
   Outra porta/host: `$env:CHROME_DEBUG_URL="http://127.0.0.1:9333"`.
2. **Chrome com perfil próprio** em `./.pinterest-profile`. Faça login uma vez e a sessão fica salva.

## Versão Playwright (experimental)

[`_pinterest_scraper_image_like_pw.js`](_pinterest_scraper_image_like_pw.js) faz o mesmo que o script
principal, mas usa **Playwright** (`playwright-core`) no lugar do Puppeteer. Ela existe para comparar
a estabilidade das duas bibliotecas antes de escolher uma.

```powershell
node _pinterest_scraper_image_like_pw.js -d "C:\Imagens\Pinterest" -l links.txt
```

- **O que é igual:** opções, saída, barra de progresso, resumo, modo `-c` e o log `_pinterest_claude_download.txt`.
  Uma lista pode começar num script e continuar no outro.
- **O que muda:**
  - os cliques esperam o elemento ficar visível e estável;
  - o botão "Reagir", o coração e o login também são encontrados pelo nome acessível (`getByRole`),
    além dos seletores CSS atuais;
  - as páginas não esperam a "rede ociosa", que no Pinterest pode não acontecer nunca.
- **Perfil:** os dois scripts usam o mesmo `./.pinterest-profile`, então não precisa logar de novo.
  **Não rode os dois ao mesmo tempo:** o Chrome trava o perfil.
- **Modo A** (`--remote-debugging-port=9222`): no fim, o script só desconecta. Seu Chrome continua aberto.

## Terminal e cores

- A barra de progresso e as cores funcionam no PowerShell / Windows Terminal (Windows 10+), cmd, macOS e Linux.
- Erros aparecem com ✗ vermelho e a mensagem em **fundo vermelho com letra amarela**; ✓ fica verde.
- Fora de um terminal (saída redirecionada para arquivo), a barra e as cores são desativadas.
- `NO_COLOR=1` desativa as cores; `FORCE_COLOR=1` força as cores.

## Testes

[`_test_validate.js`](_test_validate.js) roda o scraper com uma lista e valida o resultado de ponta a ponta:
resumo final, imagens gravadas (formato, nome e tamanho), o log `_pinterest_claude_download.txt`, a
reexecução ("Nada a fazer" sem abrir o navegador) e o modo `-c`.

```powershell
# Puppeteer: _pinterest.txt → ./imgs
node _test_validate.js

# Playwright, sem reagir aos Pins
node _test_validate.js -s _pinterest_scraper_image_like_pw.js -d ./imgs_pw --no-like
```

> ⚠️ Roda o scraper **de verdade**: abre o Chrome, usa sua conta e, sem `--no-like`, reage aos Pins.
> Use `--skip-run` para só validar uma pasta já baixada. Sai com código `1` se alguma verificação falhar.

Antes de validar, o teste roda o **reset** ([`_test_reset.js`](_test_reset.js)), para começar sempre do zero:

1. apaga as imagens da pasta de destino (só `.jpg`, `.jpeg`, `.png`, `.webp` e `.gif`; os outros arquivos ficam);
2. esvazia o `_pinterest_claude_download.txt` da pasta;
3. abre cada Pin da lista e **remove a sua reação (♥)**. Só clica quando o botão confirma que há reação, então nunca adiciona uma.

Assim o teste exercita o like de verdade. O reset só aceita pastas **dentro do projeto** (nunca a raiz) e pode rodar
sozinho: `node _test_reset.js -d ./imgs -d ./imgs_pw` (`--skip-unlike` só limpa as pastas; `--skip-files` só remove
as reações). No validador, `--no-reset` pula essa etapa.

## Gerando a lista de links

O arquivo [`pinterest-links-txt.skill`](pinterest-links-txt.skill) é uma skill do Claude
(Claude in Chrome) que coleta os links das abas abertas no grupo **"Claude Links"** e gera
`_pinterest_claude_yyyyMMdd-HH-mm.txt`, pronto para usar com `-l`.

## Aviso

Use com responsabilidade e respeite os Termos de Serviço do Pinterest e os direitos
autorais das imagens.

## Licença

[MIT](LICENSE)
