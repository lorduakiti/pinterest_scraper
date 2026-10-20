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
  - Links já baixados (registrados em `_pinterest_claude_download.txt` na pasta de destino) são ignorados.
  - **Barra de progresso fixa** na última linha do terminal.
  - **Resumo final**: total da lista, baixadas, já baixadas anteriormente, erros (e não processadas, se interrompido).

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

## Conexão com o navegador

Tentada automaticamente, nesta ordem:

1. **Chrome já aberto com depuração remota**, reaproveitando a sessão e as abas:
   ```powershell
   & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-scraper"
   ```
   Outra porta/host: `$env:CHROME_DEBUG_URL="http://127.0.0.1:9333"`.
2. **Chrome com perfil próprio** em `./.pinterest-profile`. Faça login uma vez e a sessão fica salva.

## Terminal e cores

- A barra de progresso e as cores funcionam no PowerShell / Windows Terminal (Windows 10+), cmd, macOS e Linux.
- Erros aparecem com ✗ vermelho e a mensagem em **fundo vermelho com letra amarela**; ✓ fica verde.
- Fora de um terminal (saída redirecionada para arquivo), a barra e as cores são desativadas.
- `NO_COLOR=1` desativa as cores; `FORCE_COLOR=1` força as cores.

## Gerando a lista de links

O arquivo [`pinterest-links-txt.skill`](pinterest-links-txt.skill) é uma skill do Claude
(Claude in Chrome) que coleta os links das abas abertas no grupo **"Claude Links"** e gera
`_pinterest_claude_yyyyMMdd-HH-mm.txt`, pronto para usar com `-l`.

## Aviso

Use com responsabilidade e respeite os Termos de Serviço do Pinterest e os direitos
autorais das imagens.

## Licença

[MIT](LICENSE)
