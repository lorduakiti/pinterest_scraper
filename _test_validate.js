#!/usr/bin/env node
/**
 * _test_validate.js
 * ----------------------------------------------------------------------------
 * Roda o scraper com uma lista e valida o resultado de ponta a ponta:
 * saída do terminal, resumo final, imagens gravadas e o log
 * "_pinterest_claude_download.txt" da pasta de destino.
 *
 * ATENÇÃO: roda o scraper de verdade (abre o Chrome, usa a conta do Pinterest
 * e, sem --no-like, reage aos Pins). Antes, o reset (_test_reset.js) APAGA as
 * imagens da pasta, ESVAZIA o log e REMOVE as reações dos Pins da lista.
 * Use --skip-run para só validar a pasta (sem reset).
 *
 * Uso:
 *   node _test_validate.js [opções]
 *
 * Opções:
 *   -s, --script <arq.js>  Script a testar (padrão: _pinterest_scraper_image_like.js)
 *   -l, --list <arq.txt>   Lista de links (padrão: _pinterest.txt)
 *   -d, --dir <pasta>      Pasta de destino (padrão: ./imgs)
 *       --no-like          Repassa --no-like ao scraper
 *       --skip-run         Não roda o scraper; só valida o log/pasta contra a lista
 *       --no-reset         Não roda o reset antes (mantém imagens, log e reações)
 *   -h, --help             Mostra esta ajuda
 *
 * Etapas:
 *   0. Reset: limpa a pasta e o log e remove as reações (ver _test_reset.js)
 *   1. Execução: roda o scraper e valida resumo, arquivos, log e a lista (intocada)
 *   2. Reexecução: com tudo baixado, deve sair "Nada a fazer" sem abrir o navegador
 *   3. Validação -c: o modo de checagem deve indicar 0 pendentes
 *
 * Código de saída: 0 se nenhuma verificação falhou, 1 caso contrário.
 * ----------------------------------------------------------------------------
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const LOG_FILE_NAME = '_pinterest_claude_download.txt';
const IMAGE_MAGIC = {
  '.jpg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  '.webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

// ----------------------------------------------------------------------- cores
const on = !!process.stdout.isTTY && typeof process.stdout.hasColors === 'function' && process.stdout.hasColors();
const sgr = (codes) => (s) => (on ? `\x1b[${codes}m${s}\x1b[0m` : String(s));
const C = { red: sgr('31'), green: sgr('32'), yellow: sgr('33'), dim: sgr('2'), bold: sgr('1') };

// ------------------------------------------------------------------ argumentos
function parseArgs(argv) {
  const opts = { script: '_pinterest_scraper_image_like.js', list: '_pinterest.txt', dir: './imgs', like: true, run: true, reset: true, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Valor ausente para ${a}`);
      return v;
    };
    switch (a) {
      case '-s': case '--script': opts.script = next(); break;
      case '-l': case '--list':   opts.list = next(); break;
      case '-d': case '--dir':    opts.dir = next(); break;
      case '--no-like':           opts.like = false; break;
      case '--skip-run':          opts.run = false; break;
      case '--no-reset':          opts.reset = false; break;
      case '-h': case '--help':   opts.help = true; break;
      default: throw new Error(`Opção desconhecida: ${a}`);
    }
  }
  return opts;
}

// ----------------------------------------------------------------- verificações
const results = [];
function check(ok, label, detail = '') {
  results.push(ok ? 'pass' : 'fail');
  console.log(`  ${ok ? C.green('✓') : C.red('✗')} ${label}${detail ? C.dim(` — ${detail}`) : ''}`);
  return ok;
}
function warn(label, detail = '') {
  results.push('warn');
  console.log(`  ${C.yellow('⚠')} ${label}${detail ? C.dim(` — ${detail}`) : ''}`);
}
const section = (title) => console.log(`\n${C.bold(`━━━━━━━ ${title} ━━━━━━━`)}`);

// ----------------------------------------------------- mesmas regras do scraper
/** Igual a linkKey() do scraper: ID do Pin ou URL normalizada. */
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

/** Igual a readLinks() do scraper: um link por linha, sem vazios, # e duplicados exatos. */
function readLinks(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim());
  return [...new Set(lines.filter((l) => l && !l.startsWith('#')))].filter((l) => /^https?:\/\//i.test(l));
}

function readLogLines(dir) {
  const file = path.join(dir, LOG_FILE_NAME);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const listFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f !== LOG_FILE_NAME) : []);

// ------------------------------------------------------------------- execução
/**
 * Roda o scraper com stdout e stderr no MESMO arquivo, para preservar a ordem
 * das linhas, e repete a saída na tela enquanto roda. stdin é herdado (prompts).
 */
function runScraper(script, args) {
  const outFile = path.join(os.tmpdir(), `pinterest_test_${process.pid}_${Date.now()}.log`);
  const fd = fs.openSync(outFile, 'w');
  const started = Date.now();
  const child = spawn(process.execPath, [script, ...args], {
    stdio: ['inherit', fd, fd],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  let shown = 0;
  // Repete só linhas completas (a última pode estar pela metade); no fim, tudo
  const pump = (final = false) => {
    const text = fs.readFileSync(outFile, 'utf8');
    const end = final ? text.length : text.lastIndexOf('\n') + 1;
    if (end <= shown) return;
    const lines = text.slice(shown, end).replace(/\n$/, '').split('\n');
    process.stdout.write(C.dim(lines.map((l) => `  │ ${l}`).join('\n')) + '\n');
    shown = end;
  };
  const timer = setInterval(pump, 500);
  return new Promise((resolve) => {
    child.on('exit', (code) => {
      clearInterval(timer);
      fs.closeSync(fd);
      pump(true);
      const output = fs.readFileSync(outFile, 'utf8');
      fs.rmSync(outFile, { force: true });
      resolve({ code, output, seconds: (Date.now() - started) / 1000 });
    });
  });
}

/** Extrai o resumo e os eventos por Pin da saída do scraper. */
function parseOutput(output) {
  const lines = output.split(/\r?\n/);
  const num = (label) => {
    const m = output.match(new RegExp(`^\\s+${label} \\.*\\s+(\\d+)\\s*$`, 'm'));
    return m ? Number(m[1]) : null;
  };
  const pins = [];
  let current = null;
  let inErrorList = false;
  const errorLinks = [];
  for (const line of lines) {
    const header = line.match(/^\[(\d+)\/(\d+)\] (\S+)\s*$/);
    if (header) { current = { link: header[3], saved: null, like: null, error: null, reloads: 0 }; pins.push(current); continue; }
    if (/Pins com erro/.test(line)) { inErrorList = true; current = null; continue; }
    if (inErrorList) {
      const m = line.match(/^\s+- (https?:\/\/\S+)/);
      if (m) errorLinks.push(m[1]);
      else if (/^\S/.test(line) || /Like não confirmado em/.test(line)) inErrorList = false;
      continue;
    }
    if (!current) continue;
    const saved = line.match(/Salva: (.+?)( \(resolução original\))?\s*$/);
    if (/Página incompleta .* recarregando/.test(line)) current.reloads++;
    else if (saved) current.saved = saved[1];
    else if (/Reação de coração aplicada e confirmada/.test(line)) current.like = 'ok';
    else if (/já havia reação/.test(line)) current.like = /restaurada/.test(line) ? 'restored' : 'already';
    else if (/LIKE NÃO REALIZADO/.test(line)) {
      current.like = 'fail';
      const m = line.match(/contador (\d+(?:\.\d+)?) -> (\d+(?:\.\d+)?)/);
      if (m) current.counter = [Number(m[1]), Number(m[2])];
    }
    else if (/✗ Erro:/.test(line)) current.error = line.replace(/^.*✗ Erro:\s*/, '').trim();
  }
  return {
    pins, errorLinks,
    summary: {
      total: num('Total de imagens da lista'),
      downloaded: num('Baixadas nesta execução'),
      skipped: num('Já baixadas anteriormente'),
      errors: num('Erros'),
      pending: num('Não processadas') ?? 0,
      likeFail: num('Like não confirmado') ?? 0,
    },
    loggedIn: /Usuário logado no Pinterest/.test(output),
    notLoggedIn: /Usuário NÃO está logado/.test(output),
    nothingToDo: /Nada a fazer/.test(output),
    openedBrowser: /Chrome iniciado|Conectado ao Chrome/.test(output),
  };
}

// ------------------------------------------------------------------------ main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    const src = fs.readFileSync(__filename, 'utf8');
    return console.log(src.slice(src.indexOf('/**') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
  }

  const script = path.resolve(opts.script);
  const listFile = path.resolve(opts.list);
  const dir = path.resolve(opts.dir);
  if (!fs.existsSync(script)) throw new Error(`Script não encontrado: ${script}`);
  if (!fs.existsSync(listFile)) throw new Error(`Lista não encontrada: ${listFile}`);
  fs.mkdirSync(dir, { recursive: true });

  // ---------------------------------------------------------------- etapa 0
  const doReset = opts.run && opts.reset;
  if (doReset) {
    section('0. Reset');
    const reset = await runScraper(path.join(__dirname, '_test_reset.js'), ['-l', listFile, '-d', dir]);
    const okReset = check(reset.code === 0, 'Reset concluído', `código ${reset.code}`);
    check(listFiles(dir).filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f)).length === 0, 'Pasta sem imagens');
    check((readLogLines(dir) || []).length === 0, 'Log vazio');
    if (!okReset) {
      console.log(`\n${C.red('✗')} Reset falhou: a validação não foi executada.`);
      process.exitCode = 1;
      return;
    }
  }

  const links = readLinks(listFile);
  const listKeys = new Set(links.map(linkKey));
  const preLog = readLogLines(dir) || [];
  const preKeys = new Set(preLog.map(linkKey));
  const preFiles = new Set(listFiles(dir));
  const listHash = sha1(listFile);
  const args = ['-d', dir, '-l', listFile, ...(opts.like ? [] : ['--no-like'])];

  console.log(`\n${C.bold(`Teste: ${path.basename(script)}`)}`);
  console.log(`  lista: ${listFile} (${links.length} link(s))`);
  console.log(`  pasta: ${dir} (${preFiles.size} arquivo(s), ${preKeys.size} link(s) no log antes)`);
  console.log(`  like:  ${opts.like ? 'sim' : 'não (--no-like)'}`);

  // ---------------------------------------------------------------- etapa 1
  let run = null;
  let parsed = null;
  if (opts.run) {
    section('1. Execução');
    run = await runScraper(script, args);
    parsed = parseOutput(run.output);
    const s = parsed.summary;
    console.log(C.dim(`  (concluído em ${run.seconds.toFixed(1)} s, código de saída ${run.code})`));

    if (parsed.notLoggedIn) warn('Usuário NÃO estava logado: like ignorado e o script pode ter parado no prompt');
    check(s.total !== null, 'Resumo final exibido');
    check(s.total === links.length, 'Total do resumo = links da lista', `${s.total} × ${links.length}`);
    const expectedSkipped = links.filter((l) => preKeys.has(linkKey(l))).length;
    check(s.skipped === expectedSkipped, 'Já baixadas = links que já estavam no log', `${s.skipped} × ${expectedSkipped}`);
    check(s.downloaded + s.skipped + s.errors + s.pending === s.total,
      'Baixadas + já baixadas + erros + não processadas = total',
      `${s.downloaded} + ${s.skipped} + ${s.errors} + ${s.pending} = ${s.total}`);
    check(s.pending === 0, 'Nenhum Pin ficou sem processar');
    check(run.code === (s.errors > 0 ? 1 : 0), 'Código de saída coerente com os erros', `código ${run.code}, ${s.errors} erro(s)`);
    check(parsed.pins.length === links.length - expectedSkipped, 'Um cabeçalho [i/n] por Pin processado',
      `${parsed.pins.length} × ${links.length - expectedSkipped}`);
    check(parsed.errorLinks.length === s.errors, 'Lista de Pins com erro bate com o resumo', `${parsed.errorLinks.length} × ${s.errors}`);
    parsed.errorLinks.forEach((l) => warn('Pin com erro', l));
    // Ciclo de carregamento: no máximo LOAD_ATTEMPTS - 1 (2) refreshes por Pin
    check(parsed.pins.every((p) => p.reloads <= 2), 'No máximo 2 refreshes por Pin (3 tentativas)');
    parsed.pins.filter((p) => p.reloads).forEach((p) => warn(`Página recarregada ${p.reloads}x`, p.link));

    // Arquivos
    const saved = parsed.pins.filter((p) => p.saved);
    check(saved.length === s.downloaded, 'Uma linha "Salva" por imagem baixada', `${saved.length} × ${s.downloaded}`);
    for (const p of saved) {
      const f = p.saved;
      const exists = fs.existsSync(f);
      const inDir = path.dirname(path.resolve(f)) === dir;
      const ext = path.extname(f).toLowerCase();
      const head = exists ? fs.readFileSync(f).subarray(0, 16) : Buffer.alloc(0);
      const size = exists ? fs.statSync(f).size : 0;
      check(exists && inDir && size > 0 && !!IMAGE_MAGIC[ext]?.(head) && /^[\w.-]+$/.test(path.basename(f)),
        `Imagem válida: ${path.basename(f)}`,
        exists ? `${(size / 1024).toFixed(0)} KB, ${ext}${inDir ? '' : ', FORA da pasta'}` : 'arquivo não existe');
    }
    const newFiles = listFiles(dir).filter((f) => !preFiles.has(f));
    check(newFiles.length === s.downloaded, 'Arquivos novos na pasta = imagens baixadas', `${newFiles.length} × ${s.downloaded}`);

    // Likes
    if (opts.like && parsed.loggedIn) {
      const ok = saved.filter((p) => p.like === 'ok').length;
      const already = saved.filter((p) => p.like === 'already').length;
      // A trava do scraper restaurou uma reação que o clique desfez: funcionou, mas indica estado lido cedo demais
      saved.filter((p) => p.like === 'restored').forEach((p) => warn('Reação desfeita pelo clique e restaurada pela trava', p.link));
      const failed = saved.filter((p) => p.like === 'fail' || p.like === null);
      check(failed.length === s.likeFail, 'Likes não confirmados batem com o resumo', `${failed.length} × ${s.likeFail}`);
      // Contador que CAI após o clique = o clique desfez uma reação que já existia
      const undone = failed.filter((p) => p.counter && p.counter[1] < p.counter[0]);
      check(undone.length === 0, 'Nenhuma reação existente foi desfeita',
        undone.map((p) => `${p.link} (contador ${p.counter[0]} -> ${p.counter[1]})`).join(', '));
      failed.filter((p) => !undone.includes(p)).forEach((p) => warn('Like não confirmado', p.link));
      // Após o reset nenhum Pin tem reação: o like precisa ser APLICADO (não "já havia")
      if (doReset) check(ok === saved.length, 'Like aplicado em todos os Pins (reações removidas no reset)', `${ok} de ${saved.length}`);
      if (!failed.length) check(true, 'Like confirmado em todas as imagens baixadas', `${ok} aplicado(s), ${already} já existente(s)`);
    }
  }

  // Log (vale também com --skip-run)
  section(opts.run ? '1b. Log de downloads' : 'Log de downloads');
  const postLog = readLogLines(dir);
  const logFile = path.join(dir, LOG_FILE_NAME);
  if (!postLog) {
    check(!run || parsed.summary.downloaded === 0, 'Log ausente só porque nada foi baixado', logFile);
  } else {
    const postKeys = postLog.map(linkKey);
    check(new Set(postKeys).size === postKeys.length, 'Log sem links duplicados', `${postLog.length} linha(s)`);
    check(fs.readFileSync(logFile, 'utf8').endsWith('\n'), 'Log termina com quebra de linha');
    const strangers = postLog.filter((l) => !listKeys.has(linkKey(l)) && !preKeys.has(linkKey(l)));
    check(strangers.length === 0, 'Log só contém links da lista (ou que já estavam nele)', strangers.join(', '));
    check(preLog.every((l, i) => postLog[i] === l), 'Linhas antigas do log preservadas (só acrescenta)');
    if (run) {
      const keys = new Set(postKeys);
      const downloadedLinks = parsed.pins.filter((p) => p.saved).map((p) => p.link);
      const missing = downloadedLinks.filter((l) => !keys.has(linkKey(l)));
      check(missing.length === 0, 'Todo Pin baixado está no log', missing.join(', '));
      const leaked = parsed.errorLinks.filter((l) => keys.has(linkKey(l)) && !preKeys.has(linkKey(l)));
      check(leaked.length === 0, 'Pins com erro NÃO foram para o log', leaked.join(', '));
      check(postLog.length === preLog.length + downloadedLinks.length, 'Log cresceu exatamente o número de baixadas',
        `${preLog.length} + ${downloadedLinks.length} = ${postLog.length}`);
    }
  }
  check(sha1(listFile) === listHash, 'Arquivo da lista não foi alterado');

  // ---------------------------------------------------------------- etapa 2
  if (run && parsed.summary.errors === 0 && parsed.summary.pending === 0) {
    section('2. Reexecução (tudo já baixado)');
    const logBefore = sha1(logFile);
    const filesBefore = listFiles(dir).length;
    const again = await runScraper(script, args);
    const p2 = parseOutput(again.output);
    check(again.code === 0, 'Código de saída 0', `código ${again.code}`);
    check(p2.nothingToDo, '"Nada a fazer" exibido');
    check(!p2.openedBrowser, 'Navegador não foi aberto');
    check(p2.summary.skipped === links.length && p2.summary.downloaded === 0, 'Resumo: tudo como já baixado',
      `já baixadas ${p2.summary.skipped}, baixadas ${p2.summary.downloaded}`);
    check(listFiles(dir).length === filesBefore && sha1(logFile) === logBefore, 'Nenhum arquivo novo e log inalterado');
  } else if (run) {
    warn('Reexecução pulada: houve erros ou Pins não processados na etapa 1');
  }

  // ---------------------------------------------------------------- etapa 3
  section('3. Validação -c');
  const chk = await runScraper(script, ['-c', '-d', dir, '-l', listFile]);
  const pend = chk.output.match(/^\s+Pendentes \.*\s+(\d+)/m);
  const expectedPending = links.filter((l) => !new Set((readLogLines(dir) || []).map(linkKey)).has(linkKey(l))).length;
  check(!!pend && Number(pend[1]) === expectedPending, 'Pendentes do -c = links fora do log', `${pend?.[1]} × ${expectedPending}`);
  check(chk.code === (expectedPending ? 1 : 0), 'Código de saída do -c coerente', `código ${chk.code}`);
  check(!/Chrome iniciado|Conectado ao Chrome/.test(chk.output), 'Navegador não foi aberto');

  // ---------------------------------------------------------------- resultado
  const n = (k) => results.filter((r) => r === k).length;
  section('Resultado');
  console.log(`  ${C.green(`✓ ${n('pass')} ok`)}   ${n('fail') ? C.red(`✗ ${n('fail')} falha(s)`) : '✗ 0 falhas'}   ${C.yellow(`⚠ ${n('warn')} aviso(s)`)}` +
    (run ? C.dim(`   · execução em ${run.seconds.toFixed(1)} s`) : ''));
  process.exitCode = n('fail') ? 1 : 0;
}

main().catch((err) => {
  console.error(`${C.red('✗')} Erro: ${err.message}`);
  process.exitCode = 1;
});
