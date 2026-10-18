#!/usr/bin/env node
/**
 * _pinterest_scraper_image_like.js
 * ----------------------------------------------------------------------------
 * 1. Verifica se o usuário está logado no Pinterest
 * 2. Descobre o título da imagem principal do Pin (<img>)
 * 3. Baixa a imagem renomeando-a com o título ajustado
 * 4. Após download bem-sucedido, reage com coração no botão "Reagir"
 * 5. Modo lista: lê links de um .txt (um por linha), com delay entre downloads,
 *    e salva os links baixados em "_pinterest_claude_download.txt"
 *
 * Requisitos: Node.js 18+  |  npm i puppeteer-core
 *
 * Uso:
 *   node _pinterest_scraper_image_like.js [opções]
 *
 * Opções:
 *   -d, --dir <pasta>      Pasta padrão de download (se omitida, pergunta no terminal)
 *   -l, --list <arq.txt>   Arquivo .txt com um link de Pin por linha
 *   -t, --delay <seg>      Delay entre downloads da lista (padrão: 1 segundo)
 *   -u, --url <link>       Link de um Pin específico (modo único)
 *       --no-like          Não reage com coração após o download
 *   -h, --help             Mostra esta ajuda
 *
 * Exemplos:
 *   node _pinterest_scraper_image_like.js -d "C:\Imagens"                (aba aberta)
 *   node _pinterest_scraper_image_like.js -d ./img -l links.txt -t 2.5   (lista)
 *
 * Conexão com o navegador (automática, nesta ordem):
 *   A) Chrome aberto com depuração remota (usa a aba do Pin já aberta):
 *        chrome --remote-debugging-port=9222 --user-data-dir="C:\chrome-scraper"
 *   B) Se não houver, abre um Chrome com perfil próprio (./.pinterest-profile).
 *      Faça login uma vez; a sessão fica salva.
 * ----------------------------------------------------------------------------
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline/promises');
const puppeteer = require('puppeteer-core');

const DEBUG_URL = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';
const CHROME_PATH = process.env.CHROME_PATH || detectChrome();
const PROFILE_DIR = path.resolve(__dirname, '.pinterest-profile');
const LOG_FILE_NAME = '_pinterest_claude_download.txt';
const PIN_URL_RE = /pinterest\.[a-z.]+\/pin\//i;

// ------------------------------------------------------------------ argumentos
function parseArgs(argv) {
  const opts = { dir: null, list: null, delay: 1, url: null, like: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Valor ausente para ${a}`);
      return v;
    };
    switch (a) {
      case '-d': case '--dir':   opts.dir = next(); break;
      case '-l': case '--list':  opts.list = next(); break;
      case '-t': case '--delay': opts.delay = Number(next()); break;
      case '-u': case '--url':   opts.url = next(); break;
      case '--no-like':          opts.like = false; break;
      case '-h': case '--help':  opts.help = true; break;
      default:
        // Posicionais: .txt => lista | link => url | demais => pasta
        if (/\.txt$/i.test(a)) opts.list = a;
        else if (/^https?:\/\//i.test(a)) opts.url = a;
        else opts.dir = a;
    }
  }
  if (!Number.isFinite(opts.delay) || opts.delay < 0) throw new Error('--delay deve ser um número >= 0');
  if (opts.list && !/\.txt$/i.test(opts.list)) throw new Error('--list deve ser um arquivo .txt');
  return opts;
}

function printHelp() {
  const src = fs.readFileSync(__filename, 'utf8');
  console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
}

// ----------------------------------------------------------------- utilitários
function detectChrome() {
  const candidates = {
    win32: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  }[process.platform] || [];
  return candidates.find((p) => fs.existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

function resolveDir(dir) {
  return path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
}

/** Ajusta o título para nome de arquivo válido em Windows/macOS/Linux. */
function sanitizeFileName(title, maxLen = 120) {
  return title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')               // caracteres proibidos
    .replace(/[^\w\s.-]/g, '')                           // demais símbolos
    .trim()
    .replace(/\s+/g, '_')                                // espaços -> _
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, maxLen) || null;
}

/** Evita sobrescrever: nome.jpg -> nome_1.jpg -> nome_2.jpg ... */
function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base}_${i}${ext}`);
  return candidate;
}

function extFrom(contentType, url) {
  const map = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
  const ct = contentType && contentType.split(';')[0];
  if (ct && map[ct]) return map[ct];
  const m = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i);
  return m ? `.${m[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

/** Lê o .txt: um link por linha; ignora linhas vazias, comentários (#) e duplicados. */
function readLinks(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim());
  const links = [...new Set(lines.filter((l) => l && !l.startsWith('#')))];
  const invalid = links.filter((l) => !/^https?:\/\//i.test(l));
  if (invalid.length) console.warn(`⚠ ${invalid.length} linha(s) ignorada(s) por não serem links.`);
  return links.filter((l) => /^https?:\/\//i.test(l));
}

/** Salva os links baixados (acrescenta ao arquivo, sem duplicar). */
function saveDownloadedLinks(destDir, links) {
  if (!destDir || !links.length) return null;
  const file = path.join(destDir, LOG_FILE_NAME);
  const existing = fs.existsSync(file)
    ? new Set(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    : new Set();
  const fresh = links.filter((l) => !existing.has(l));
  if (fresh.length) fs.appendFileSync(file, fresh.join(os.EOL) + os.EOL, 'utf8');
  return file;
}

// --------------------------------------------------------------------- browser
async function getBrowser() {
  try {
    const browser = await puppeteer.connect({ browserURL: DEBUG_URL, defaultViewport: null });
    console.log(`✔ Conectado ao Chrome aberto (${DEBUG_URL})`);
    return { browser, attached: true };
  } catch { /* segue para o modo B */ }

  if (!CHROME_PATH) throw new Error('Chrome não encontrado. Defina a variável CHROME_PATH.');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH, headless: false, userDataDir: PROFILE_DIR, defaultViewport: null,
  });
  console.log('✔ Chrome iniciado com perfil próprio');
  return { browser, attached: false };
}

async function openPin(page, url) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  if (!PIN_URL_RE.test(page.url())) throw new Error(`Não é uma página de Pin: ${page.url()}`);
}

// ------------------------------------------------------------ passo 1: login
async function isLoggedIn(page) {
  const cookies = await page.cookies('https://www.pinterest.com', 'https://br.pinterest.com');
  const authCookie = cookies.some((c) => c.name === '_auth' && c.value === '1');
  const dom = await page.evaluate(() => ({
    profile: !!document.querySelector('[data-test-id="header-profile"], [data-test-id="header-avatar"]'),
    loginBtn: !!document.querySelector('[data-test-id="simple-login-button"], [data-test-id="login-button"]'),
  }));
  return authCookie || (dom.profile && !dom.loginBtn);
}

// ---------------------------------------------- passo 2: imagem principal + título
async function getMainImage(page) {
  await page.waitForSelector('img', { timeout: 15000 });
  return page.evaluate(() => {
    const selectors = [
      '[data-test-id="pin-closeup-image"] img',
      '[data-test-id="story-pin-image-block"] img',
      '[data-test-id="closeup-image"] img',
      '[data-test-id="visual-content-container"] img',
    ];
    let img = selectors.map((s) => document.querySelector(s)).find(Boolean);
    if (!img) {
      img = [...document.querySelectorAll('img')]
        .filter((i) => /pinimg\.com/.test(i.currentSrc || i.src))
        .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
    }
    if (!img) return null;

    let src = img.currentSrc || img.src;
    if (img.srcset) {
      const best = img.srcset.split(',').map((s) => s.trim().split(/\s+/))
        .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
      if (best) src = best[0];
    }

    // Título: alt descritivo > <h1> > og:title > <title>
    const rawAlt = (img.alt || '').trim();
    const alt = rawAlt.replace(/^Contém( uma imagem de)?:\s*/i, '').trim();
    const altIsGeneric = !alt || /^(Imagem do Pin|Pin image|Story Pin image)/i.test(rawAlt);
    const title =
      (!altIsGeneric ? alt : '') ||
      document.querySelector('h1')?.innerText.trim() ||
      document.querySelector('meta[property="og:title"]')?.content?.trim() ||
      document.title.replace(/\s*\|\s*Pinterest.*$/i, '').trim();

    return { src, title };
  });
}

// ----------------------------------------------------------- passo 3: download
async function download(srcUrl, destDir, title) {
  const urls = [...new Set([srcUrl.replace(/\/\d+x\//, '/originals/'), srcUrl])];
  for (const url of urls) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.pinterest.com/' } });
    if (!res.ok) continue;
    const ext = extFrom(res.headers.get('content-type'), url);
    const base = sanitizeFileName(title || '') || path.basename(new URL(url).pathname, ext);
    const file = uniquePath(destDir, base, ext);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return { file, original: url !== srcUrl };
  }
  throw new Error(`Falha ao baixar a imagem: ${srcUrl}`);
}

// ------------------------------------------------- passo 4: reagir com coração
async function reactWithHeart(page) {
  const BTN = 'button[data-test-id="react-button"], [data-test-id="closeup-action-items"] button[aria-label="Reagir"], button[aria-label="React"]';
  const btn = await page.waitForSelector(BTN, { visible: true, timeout: 8000 }).catch(() => null);
  if (!btn) return 'botão "Reagir" não encontrado';

  // Já reagido? Não clica de novo (o clique desfaria a reação).
  const already = await btn.evaluate((b) => b.getAttribute('aria-pressed') === 'true');
  if (already) return 'já havia reação neste Pin';

  // Se o menu de reações abrir no hover, escolhe o coração; senão, clique simples (padrão = coração).
  await btn.hover();
  await sleep(700);
  const heart = await page.$(
    '[data-test-id="reaction-heart"], [data-test-id*="heart"], [aria-label="Amei"], [aria-label="Love"], [aria-label="Coração"]'
  );
  await (heart || btn).click();
  await sleep(1000);

  const ok = await page.$eval(BTN, (b) => b.getAttribute('aria-pressed') === 'true').catch(() => false);
  return ok ? 'ok' : 'clique enviado, mas a reação não foi confirmada';
}

// --------------------------------------------------- processamento de um Pin
async function processPin(page, destDir, like) {
  const img = await getMainImage(page);
  if (!img) throw new Error('Imagem principal não encontrada.');
  console.log(`  Título: ${img.title || '(sem título)'}`);

  const { file, original } = await download(img.src, destDir, img.title);
  console.log(`  ✔ Salva: ${file}${original ? ' (resolução original)' : ''}`);

  if (like) {
    const r = await reactWithHeart(page);
    console.log(r === 'ok' ? '  ♥ Reação de coração aplicada' : `  ♥ ${r}`);
  }
  return file;
}

// ------------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  const downloaded = [];          // links baixados com sucesso (modo lista)
  let destDir = null;
  let ctx = null;
  let page = null;
  let ownPage = false;

  const flushLog = () => {
    if (!opts.list) return;
    const f = saveDownloadedLinks(destDir, downloaded);
    if (f) console.log(`📝 ${downloaded.length} link(s) registrado(s) em: ${f}`);
  };
  // Ctrl+C também salva o registro
  process.once('SIGINT', () => { console.log('\nInterrompido.'); flushLog(); process.exit(130); });

  try {
    const links = opts.list ? readLinks(path.resolve(opts.list)) : [];
    if (opts.list && !links.length) throw new Error(`Nenhum link válido em ${opts.list}`);

    ctx = await getBrowser();
    const pages = await ctx.browser.pages();

    if (opts.list || opts.url) {
      page = ctx.attached ? await ctx.browser.newPage() : pages[0] || (await ctx.browser.newPage());
      ownPage = ctx.attached;
      await openPin(page, opts.list ? links[0] : opts.url);
    } else {
      page = pages.find((p) => PIN_URL_RE.test(p.url()));
      if (!page) {
        const url = await ask('Nenhuma aba de Pin aberta. URL do Pin: ');
        page = pages[0] || (await ctx.browser.newPage());
        await openPin(page, url);
      }
    }

    // 1) Login
    const logged = await isLoggedIn(page);
    console.log(logged ? '✔ Usuário logado no Pinterest' : '✖ Usuário NÃO está logado no Pinterest');
    if (!logged) {
      if (opts.like) console.log('  (a reação de coração exige login e será ignorada)');
      if (!/^s/i.test(await ask('Continuar mesmo assim? (s/N): '))) return;
    }
    const like = opts.like && logged;

    // Pasta de destino
    destDir = resolveDir(opts.dir || (await ask('Pasta onde salvar as imagens: ')));
    fs.mkdirSync(destDir, { recursive: true });

    if (!opts.list) {
      // Modo único
      await processPin(page, destDir, like);
      return;
    }

    // Modo lista
    console.log(`\n▶ ${links.length} link(s) | delay: ${opts.delay}s | destino: ${destDir}\n`);
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      console.log(`[${i + 1}/${links.length}] ${link}`);
      if (i > 0) await openPin(page, link);   // o 1º já foi aberto
      await processPin(page, destDir, like);  // erro interrompe e cai no finally
      downloaded.push(link);
      if (i < links.length - 1 && opts.delay > 0) await sleep(opts.delay * 1000);
    }
    console.log(`\n✔ Concluído: ${downloaded.length}/${links.length} imagem(ns) baixada(s).`);
  } catch (err) {
    console.error(`\n✖ Erro: ${err.message}`);
    process.exitCode = 1;
  } finally {
    flushLog();   // ao final ou em caso de erro
    if (ctx) {
      if (ownPage && page) await page.close().catch(() => {});
      ctx.attached ? ctx.browser.disconnect() : await ctx.browser.close();
    }
  }
}

main();