#!/usr/bin/env node
/**
 * _test_reset.js
 * ----------------------------------------------------------------------------
 * Prepara o ambiente para o _test_validate.js:
 *   1. Apaga as imagens (.jpg, .jpeg, .png, .webp, .gif) das pastas de destino
 *   2. Esvazia o "_pinterest_claude_download.txt" dessas pastas
 *   3. Abre cada Pin da lista no Pinterest e REMOVE a reação (♥), se houver
 *
 * ATENÇÃO: o passo 3 altera a sua conta do Pinterest. Só clica em "Reagir"
 * quando o botão confirma (aria-pressed="true", estável) que há reação, então
 * nunca adiciona uma reação por engano.
 *
 * Segurança: só mexe em pastas DENTRO deste projeto (nunca na raiz dele) e só
 * apaga arquivos de imagem; os demais arquivos da pasta ficam intactos.
 *
 * Uso:
 *   node _test_reset.js [opções]
 *
 * Opções:
 *   -l, --list <arq.txt>   Lista de links (padrão: _pinterest.txt)
 *   -d, --dir <pasta>      Pasta de imagens a limpar; pode repetir (padrão: ./imgs)
 *       --skip-unlike      Só limpa as pastas, sem abrir o Pinterest
 *       --skip-files       Só remove as reações, sem mexer nas pastas
 *   -h, --help             Mostra esta ajuda
 *
 * Navegador: igual ao scraper — Chrome com depuração remota (CHROME_DEBUG_URL,
 * padrão http://127.0.0.1:9222) ou o Chrome instalado com ./.pinterest-profile.
 *
 * Código de saída: 0 se tudo foi resetado, 1 se algo falhou.
 * ----------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';
const PROFILE_DIR = path.resolve(__dirname, '.pinterest-profile');
const LOG_FILE_NAME = '_pinterest_claude_download.txt';
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
const PIN_URL_RE = /pinterest\.[a-z.]+\/pin\//i;
const REACT_CSS = 'button[data-test-id="react-button"], [data-test-id="closeup-action-items"] button[aria-label="Reagir"], button[aria-label="React"]';
const LOAD_ATTEMPTS = 3;       // abertura + refreshes até o botão "Reagir" aparecer
const REACT_STABLE_MS = 2000;  // estado do botão precisa ficar igual por esse tempo
const UNLIKE_WAIT_MS = 5000;   // espera o Pinterest registrar a remoção

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------------- cores
const on = !!process.stdout.isTTY && typeof process.stdout.hasColors === 'function' && process.stdout.hasColors();
const sgr = (codes) => (s) => (on ? `\x1b[${codes}m${s}\x1b[0m` : String(s));
const C = { red: sgr('31'), green: sgr('32'), yellow: sgr('33'), dim: sgr('2'), bold: sgr('1') };

// ------------------------------------------------------------------ argumentos
function parseArgs(argv) {
  const opts = { list: '_pinterest.txt', dirs: [], unlike: true, files: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Valor ausente para ${a}`);
      return v;
    };
    switch (a) {
      case '-l': case '--list':  opts.list = next(); break;
      case '-d': case '--dir':   opts.dirs.push(next()); break;
      case '--skip-unlike':      opts.unlike = false; break;
      case '--skip-files':       opts.files = false; break;
      case '-h': case '--help':  opts.help = true; break;
      default: throw new Error(`Opção desconhecida: ${a}`);
    }
  }
  if (!opts.dirs.length) opts.dirs.push('./imgs');
  return opts;
}

/** Mesmas regras do scraper: um link por linha, sem vazios, # e duplicados exatos. */
function readLinks(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim());
  return [...new Set(lines.filter((l) => l && !l.startsWith('#')))].filter((l) => /^https?:\/\//i.test(l));
}

function detectChrome() {
  const candidates = {
    win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  return process.env.CHROME_PATH || candidates.find((p) => fs.existsSync(p));
}

// ------------------------------------------------------- passo 1 e 2: pastas
/** Só aceita pastas dentro do projeto (e não a raiz dele). */
function assertSafeDir(dir) {
  const rel = path.relative(__dirname, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Pasta recusada (precisa estar dentro do projeto e não ser a raiz): ${dir}`);
  }
}

function resetDir(dir) {
  assertSafeDir(dir);
  fs.mkdirSync(dir, { recursive: true });
  const images = fs.readdirSync(dir).filter((f) => IMAGE_EXT_RE.test(f) && fs.statSync(path.join(dir, f)).isFile());
  images.forEach((f) => fs.rmSync(path.join(dir, f)));
  const log = path.join(dir, LOG_FILE_NAME);
  const hadLog = fs.existsSync(log);
  const logLines = hadLog ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length : 0;
  fs.writeFileSync(log, '', 'utf8');
  console.log(`  ${C.green('✓')} ${path.relative(__dirname, dir) || dir}: ${images.length} imagem(ns) apagada(s), ` +
    `log esvaziado (${hadLog ? `${logLines} link(s) removido(s)` : 'criado vazio'})`);
}

// ---------------------------------------------------------- passo 3: reações
async function getBrowser() {
  try {
    const browser = await chromium.connectOverCDP(DEBUG_URL, { timeout: 5000 });
    const context = browser.contexts()[0] || (await browser.newContext({ viewport: null }));
    console.log(`  ${C.green('✓')} Conectado ao Chrome aberto (${DEBUG_URL})`);
    return { context, close: () => browser.close() };   // só desconecta
  } catch { /* segue para o perfil próprio */ }
  const executablePath = detectChrome();
  if (!executablePath) throw new Error('Chrome não encontrado. Defina a variável CHROME_PATH.');
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { executablePath, headless: false, viewport: null });
  console.log(`  ${C.green('✓')} Chrome iniciado com perfil próprio`);
  return { context, close: () => context.close() };
}

async function isLoggedIn(context) {
  const cookies = await context.cookies(['https://www.pinterest.com', 'https://br.pinterest.com']);
  return cookies.some((c) => c.name === '_auth' && c.value === '1');
}

/** Abre o Pin e espera o botão "Reagir"; recarrega até LOAD_ATTEMPTS vezes. */
async function openReactButton(page, url) {
  for (let attempt = 1; attempt <= LOAD_ATTEMPTS; attempt++) {
    try {
      if (attempt === 1) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      else await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch { /* tenta achar o botão mesmo assim */ }
    if (!PIN_URL_RE.test(page.url())) throw new Error(`Não é uma página de Pin: ${page.url()}`);
    const btn = page.locator(REACT_CSS).or(page.getByRole('button', { name: /^(Reagir|React)$/i })).filter({ visible: true }).first();
    if (await btn.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) return btn;
    if (attempt < LOAD_ATTEMPTS) console.log(`    ${C.yellow('↻')} botão "Reagir" não apareceu — recarregando (tentativa ${attempt + 1}/${LOAD_ATTEMPTS})`);
  }
  throw new Error(`botão "Reagir" não apareceu após ${LOAD_ATTEMPTS} tentativas`);
}

const readPressed = async (btn) => (await btn.getAttribute('aria-pressed', { timeout: 3000 }).catch(() => null)) === 'true';

/**
 * Estado estável do botão. O Pinterest desenha aria-pressed="false" e só depois
 * aplica a reação da conta; "true" é definitivo, "false" precisa durar REACT_STABLE_MS.
 */
async function stablePressed(page, btn) {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const deadline = Date.now() + 8000;
  let last = await readPressed(btn);
  let since = Date.now();
  while (!last && Date.now() < deadline && Date.now() - since < REACT_STABLE_MS) {
    await sleep(250);
    const now = await readPressed(btn);
    if (now !== last) { last = now; since = Date.now(); }
  }
  return last;
}

async function readCount(page) {
  return page.evaluate(() => document.querySelector('[data-test-id="reactions-count"]')?.innerText.trim() ?? null).catch(() => null);
}

/** Remove a reação do Pin. Retorna 'removed' | 'none' ou lança erro. */
async function unlikePin(page, url) {
  const btn = await openReactButton(page, url);
  if (!(await stablePressed(page, btn))) return { status: 'none' };
  const before = await readCount(page);
  await btn.click();
  await sleep(UNLIKE_WAIT_MS);
  const after = await readCount(page);
  if (await readPressed(btn)) throw new Error(`a reação continua marcada após ${UNLIKE_WAIT_MS / 1000}s (contador ${before ?? '?'} -> ${after ?? '?'})`);
  return { status: 'removed', before, after };
}

async function unlikeAll(links) {
  const ctx = await getBrowser();
  const page = await ctx.context.newPage();
  const result = { removed: 0, none: 0, failed: [] };
  try {
    // Sem login não há reação da conta para remover
    await page.goto('https://br.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    if (!(await isLoggedIn(ctx.context))) throw new Error('usuário NÃO está logado no Pinterest; faça login no perfil e rode de novo');
    console.log(`  ${C.green('✓')} Usuário logado no Pinterest`);

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const prefix = `  [${i + 1}/${links.length}] ${link}`;
      try {
        const r = await unlikePin(page, link);
        if (r.status === 'removed') {
          result.removed++;
          console.log(`${prefix}\n    ${C.green('✓')} reação removida ${C.dim(`(contador ${r.before ?? '?'} -> ${r.after ?? '?'})`)}`);
        } else {
          result.none++;
          console.log(`${prefix}\n    ${C.dim('·')} já estava sem reação`);
        }
      } catch (err) {
        result.failed.push(link);
        console.log(`${prefix}\n    ${C.red('✗')} falha: ${err.message.split('\n')[0]}`);
      }
    }
  } finally {
    await page.close().catch(() => {});
    await ctx.close().catch(() => {});
  }
  return result;
}

// ------------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    const src = fs.readFileSync(__filename, 'utf8');
    return console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  }
  const listFile = path.resolve(opts.list);
  const dirs = opts.dirs.map((d) => path.resolve(d));
  dirs.forEach(assertSafeDir);   // valida tudo antes de apagar qualquer coisa

  console.log(C.bold('━━━━━━━ Reset do ambiente de teste ━━━━━━━'));
  if (opts.files) dirs.forEach(resetDir);

  let failed = 0;
  if (opts.unlike) {
    if (!fs.existsSync(listFile)) throw new Error(`Lista não encontrada: ${listFile}`);
    const links = readLinks(listFile);
    console.log(`  Removendo reações de ${links.length} Pin(s) de ${path.basename(listFile)} …`);
    const r = await unlikeAll(links);
    failed = r.failed.length;
    console.log(`  ${C.bold('Reações:')} ${C.green(`${r.removed} removida(s)`)}, ${r.none} já sem reação` +
      `${failed ? `, ${C.red(`${failed} falha(s)`)}` : ''}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(`${C.red('✗')} Erro no reset: ${err.message}`);
  process.exitCode = 1;
});
