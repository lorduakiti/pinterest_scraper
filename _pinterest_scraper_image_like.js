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
 *   -U, --user <email>     E-mail/usuário do Pinterest (login automático se deslogado)
 *   -P, --pass <senha>     Senha do Pinterest (se omitida, é pedida oculta no terminal)
 *   -h, --help             Mostra esta ajuda
 *
 * Credenciais também podem vir das variáveis de ambiente (recomendado, pois
 * não ficam no histórico do terminal): PINTEREST_USER e PINTEREST_PASS.
 * Se o Pinterest pedir CAPTCHA ou verificação em 2 etapas, conclua no navegador;
 * o script aguarda até 2 minutos.
 *
 * Exemplos:
 *   node _pinterest_scraper_image_like.js -d "C:\Imagens"                (aba aberta)
 *   node _pinterest_scraper_image_like.js -d ./img -l links.txt -t 2.5   (lista)
 * 
 *   # Pelos parâmetros
 *   node _pinterest_scraper_image_like.js -d .\img -l links.txt -U seu@email.com -P "suaSenha"
 *   
 *   # Só o usuário: a senha é pedida no terminal, sem aparecer na tela
 *   node _pinterest_scraper_image_like.js -d .\img -U seu@email.com
 *   
 *   # Por variáveis de ambiente (recomendado)
 *   $env:PINTEREST_USER="seu@email.com"; $env:PINTEREST_PASS="suaSenha"
 *   node _pinterest_scraper_image_like.js -d .\img -l links.txt
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
const LIKE_WAIT_MS = 5000;   // espera após o like, antes de validar e sair da página
const PIN_URL_RE = /pinterest\.[a-z.]+\/pin\//i;

// ------------------------------------------------------------------ argumentos
function parseArgs(argv) {
  const opts = {
    dir: null, list: null, delay: 1, url: null, like: true, help: false,
    user: process.env.PINTEREST_USER || null,
    pass: process.env.PINTEREST_PASS || null,
  };
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
      case '-U': case '--user':  opts.user = next(); break;
      case '-P': case '--pass':  opts.pass = next(); break;
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

/** Pergunta no terminal sem exibir o que é digitado (para senha). */
async function askHidden(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
  const answer = await rl.question(question);
  rl.close();
  process.stdout.write('\n');
  return answer;
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

/**
 * Chave de comparação de links: usa o ID do Pin quando existir (ignora domínio
 * br./www., barra final, query string e #); senão, a URL normalizada.
 */
function linkKey(link) {
  const pin = link.match(/\/pin\/(\d+)/i);
  if (pin) return `pin:${pin[1]}`;
  try {
    const u = new URL(link);
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return link.trim();
  }
}

/** Lê o log de downloads da pasta (somente leitura). Retorna Set de chaves. */
function readDownloadLog(destDir) {
  const file = path.join(destDir, LOG_FILE_NAME);
  if (!fs.existsSync(file)) return { file, keys: new Set(), exists: false };
  const keys = new Set(
    fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map(linkKey)
  );
  return { file, keys, exists: true };
}

/** Salva os links baixados (acrescenta ao arquivo, sem duplicar). */
function saveDownloadedLinks(destDir, links) {
  if (!destDir || !links.length) return null;
  const file = path.join(destDir, LOG_FILE_NAME);
  const { keys: existing } = readDownloadLog(destDir);
  const fresh = links.filter((l) => !existing.has(linkKey(l)));
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

/**
 * Faz login com usuário e senha e volta para a página do Pin.
 * Aguarda até 2 min caso o Pinterest exija CAPTCHA/2FA (concluídos pelo usuário).
 */
async function loginPinterest(page, user, pass) {
  const returnUrl = page.url();
  const origin = new URL(returnUrl).origin;
  console.log(`→ Fazendo login como ${user} ...`);

  await page.goto(`${origin}/login/`, { waitUntil: 'networkidle2', timeout: 45000 });

  const EMAIL = 'input#email, input[name="id"], input[type="email"]';
  const PASS = 'input#password, input[name="password"], input[type="password"]';
  const SUBMIT = 'button[type="submit"], [data-test-id="registerFormSubmitButton"]';

  const emailInput = await page.waitForSelector(EMAIL, { visible: true, timeout: 15000 }).catch(() => null);
  if (!emailInput) {
    if (await isLoggedIn(page)) return true;   // já redirecionou logado
    throw new Error('Formulário de login não encontrado.');
  }

  await emailInput.click({ clickCount: 3 });
  await emailInput.type(user, { delay: 40 });
  const passInput = await page.waitForSelector(PASS, { visible: true, timeout: 10000 });
  await passInput.click({ clickCount: 3 });
  await passInput.type(pass, { delay: 40 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click(SUBMIT),
  ]);

  // Aguarda confirmação do login (inclui tempo para CAPTCHA/2FA manual)
  const deadline = Date.now() + 120000;
  let warned = false;
  while (Date.now() < deadline) {
    if (await isLoggedIn(page)) break;
    const errorMsg = await page.evaluate(() => {
      const el = document.querySelector('[data-test-id="login-error"], #email-error, #password-error, [role="alert"]');
      return el ? el.innerText.trim() : null;
    }).catch(() => null);
    if (errorMsg) throw new Error(`Login recusado pelo Pinterest: ${errorMsg}`);
    if (!warned && Date.now() > deadline - 110000) {
      console.log('  … aguardando confirmação (conclua CAPTCHA/2FA no navegador, se solicitado)');
      warned = true;
    }
    await sleep(2000);
  }
  if (!(await isLoggedIn(page))) throw new Error('Tempo esgotado aguardando o login.');

  console.log('✔ Login realizado com sucesso');
  await page.goto(returnUrl, { waitUntil: 'networkidle2', timeout: 45000 });
  return true;
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

    // Título da imagem: alt descritivo > <h1> do Pin > og:title
    const rawAlt = (img.alt || '').trim();
    const alt = rawAlt.replace(/^Contém( uma imagem de)?:\s*/i, '').trim();
    const altIsGeneric = !alt || /^(Imagem do Pin|Pin image|Story Pin image)/i.test(rawAlt);
    const imageTitle =
      (!altIsGeneric ? alt : '') ||
      document.querySelector('h1')?.innerText.trim() ||
      document.querySelector('meta[property="og:title"]')?.content?.trim() ||
      '';

    // Título da página (<title>), usado quando a imagem não tem título
    const pageTitle = document.title.replace(/\s*[|\-–]\s*Pinterest.*$/i, '').trim();

    return { src, imageTitle, pageTitle };
  });
}

// ----------------------------------------------------------- passo 3: download
async function download(srcUrl, destDir, baseName) {
  const urls = [...new Set([srcUrl.replace(/\/\d+x\//, '/originals/'), srcUrl])];
  for (const url of urls) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.pinterest.com/' } });
    if (!res.ok) continue;
    const ext = extFrom(res.headers.get('content-type'), url);
    const base = baseName || path.basename(new URL(url).pathname, ext);
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

  const countBefore = await readReactionsCount(page);

  // Se o menu de reações abrir no hover, escolhe o coração; senão, clique simples (padrão = coração).
  await btn.hover();
  await sleep(700);
  const heart = await page.$(
    '[data-test-id="reaction-heart"], [data-test-id*="heart"], [aria-label="Amei"], [aria-label="Love"], [aria-label="Coração"]'
  );
  await (heart || btn).click();

  // Aguarda o Pinterest registrar a reação antes de validar e sair da página
  await sleep(LIKE_WAIT_MS);

  // Validação: botão marcado (aria-pressed=true) ou contador de reações aumentou
  const pressed = await page.$eval(BTN, (b) => b.getAttribute('aria-pressed') === 'true').catch(() => false);
  const countAfter = await readReactionsCount(page);
  const countUp = countBefore !== null && countAfter !== null && countAfter > countBefore;

  if (pressed || countUp) return 'ok';
  return `falha: reação NÃO confirmada após ${LIKE_WAIT_MS / 1000}s ` +
         `(aria-pressed=${pressed}, contador ${countBefore ?? '?'} -> ${countAfter ?? '?'})`;
}

/** Lê o contador de reações do Pin (null se não existir). */
async function readReactionsCount(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-test-id="reactions-count"]');
    if (!el) return null;
    const t = el.innerText.trim().toLowerCase().replace(',', '.');
    const n = parseFloat(t);
    if (Number.isNaN(n)) return null;
    return /mil|k/.test(t) ? n * 1000 : /mi|m/.test(t) ? n * 1e6 : n;
  }).catch(() => null);
}

// --------------------------------------------------- processamento de um Pin
async function processPin(page, destDir, like) {
  const img = await getMainImage(page);
  if (!img) throw new Error('Imagem principal não encontrada.');
  // Nome do arquivo: título da imagem > título da página > nome original da URL
  let baseName = sanitizeFileName(img.imageTitle || '');
  if (baseName) {
    console.log(`  Título da imagem: ${img.imageTitle}`);
  } else {
    const pageTitle = img.pageTitle || (await page.title()).replace(/\s*[|\-–]\s*Pinterest.*$/i, '').trim();
    baseName = sanitizeFileName(pageTitle || '');
    console.log(baseName
      ? `  Imagem sem título → usando o título da página: ${pageTitle}`
      : '  Imagem e página sem título → usando o nome original do arquivo');
  }

  const { file, original } = await download(img.src, destDir, baseName);
  console.log(`  ✔ Salva: ${file}${original ? ' (resolução original)' : ''}`);

  let liked = null;
  if (like) {
    const r = await reactWithHeart(page);
    liked = r === 'ok' || r.startsWith('já havia');
    if (r === 'ok') console.log('  ♥ Reação de coração aplicada e confirmada');
    else if (liked) console.log(`  ♥ ${r}`);
    else console.warn(`  ✖ LIKE NÃO REALIZADO: ${r}`);
  }
  return { file, liked };
}

// ------------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  const downloaded = [];          // links baixados com sucesso (modo lista)
  const likeFailures = [];        // links em que o like não foi confirmado
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
    // Modo lista: lê o TXT (somente leitura — o arquivo original nunca é alterado)
    let links = opts.list ? readLinks(path.resolve(opts.list)) : [];
    if (opts.list && !links.length) throw new Error(`Nenhum link válido em ${opts.list}`);

    if (opts.list) {
      // A pasta é definida antes, para consultar o log de downloads já existente
      destDir = resolveDir(opts.dir || (await ask('Pasta onde salvar as imagens: ')));
      fs.mkdirSync(destDir, { recursive: true });

      const log = readDownloadLog(destDir);
      if (log.exists) {
        const total = links.length;
        const skipped = links.filter((l) => log.keys.has(linkKey(l)));
        links = links.filter((l) => !log.keys.has(linkKey(l)));
        console.log(`📝 Log encontrado: ${log.file}`);
        console.log(`   ${skipped.length} de ${total} link(s) já baixado(s) serão ignorados.`);
        skipped.forEach((l) => console.log(`   ↷ ${l}`));
      }
      if (!links.length) {
        console.log('✔ Nada a fazer: todos os links da lista já foram baixados.');
        return;
      }
    }

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
    let logged = await isLoggedIn(page);
    console.log(logged ? '✔ Usuário logado no Pinterest' : '✖ Usuário NÃO está logado no Pinterest');
    if (!logged && opts.user) {
      const pass = opts.pass || (await askHidden(`Senha do Pinterest para ${opts.user}: `));
      try {
        logged = await loginPinterest(page, opts.user, pass);
      } catch (e) {
        console.error(`✖ Falha no login: ${e.message}`);
        if (!PIN_URL_RE.test(page.url())) await page.goBack().catch(() => {});
      }
    }
    if (!logged) {
      if (opts.like) console.log('  (a reação de coração exige login e será ignorada)');
      if (!/^s/i.test(await ask('Continuar mesmo assim? (s/N): '))) return;
    }
    const like = opts.like && logged;

    // Pasta de destino (no modo lista já foi definida antes)
    if (!destDir) {
      destDir = resolveDir(opts.dir || (await ask('Pasta onde salvar as imagens: ')));
      fs.mkdirSync(destDir, { recursive: true });
    }

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
      const { liked } = await processPin(page, destDir, like);  // erro interrompe e cai no finally
      downloaded.push(link);
      if (liked === false) likeFailures.push(link);
      if (i < links.length - 1 && opts.delay > 0) await sleep(opts.delay * 1000);
    }
    console.log(`\n✔ Concluído: ${downloaded.length}/${links.length} imagem(ns) baixada(s).`);
    if (likeFailures.length) {
      console.warn(`✖ Like não confirmado em ${likeFailures.length} Pin(s):`);
      likeFailures.forEach((l) => console.warn(`   - ${l}`));
    }
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