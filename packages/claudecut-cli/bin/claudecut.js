#!/usr/bin/env node
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ClaudeCutProxy } = require('../src/proxy');
const { loadSessions } = require('../src/ledger');
const { scan, applyRules } = require('../src/init');
const pkg = require('../package.json');

const c = {
  green: s => `\x1b[32m${s}\x1b[0m`, cyan: s => `\x1b[36m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m`,
  red: s => `\x1b[31m${s}\x1b[0m`, dim: s => `\x1b[90m${s}\x1b[0m`, bold: s => `\x1b[1m${s}\x1b[0m`
};

const HELP = `
✂️  ClaudeCut v${pkg.version}: see and cut what Claude Code costs

Usage:
  claudecut [options] [claude args]   Run Claude Code through ClaudeCut (default)
  claudecut proxy [options]           Only run the proxy (for SDK apps, Cursor, etc.)
  claudecut init [--yes]              Shield a big repo: keep lockfiles/build output out of context
  claudecut report                    Cost summary of your recent sessions

Options:
  --budget <usd>     Block new requests once this session has spent this much
  --measure-only     Change nothing; just measure and show what ClaudeCut would do
  --port <num>       Preferred proxy port (default 9876; next free port is used if busy)
  --upstream <url>   Forward to this API base URL (default: $ANTHROPIC_BASE_URL or Anthropic)
  --no-open          Don't open the live dashboard in the browser
  -v, --version      Show version
  -h, --help         Show this help

Examples:
  claudecut
  claudecut --budget 5
  claudecut --resume
  claudecut "fix the failing auth tests"
`;

function takeOption(args, name, hasValue = true) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = hasValue ? args[i + 1] : true;
  args.splice(i, hasValue ? 2 : 1);
  return v;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {}
}

/** Locate the Claude Code executable. Returns {cmd, args, shell} for spawn. */
function resolveClaude() {
  if (process.env.CLAUDECUT_CLAUDE_BIN) return { cmd: process.env.CLAUDECUT_CLAUDE_BIN, viaCmd: /\.(cmd|bat)$/i.test(process.env.CLAUDECUT_CLAUDE_BIN) };
  if (process.platform !== 'win32') return { cmd: 'claude', viaCmd: false };
  try {
    const hits = execFileSync('where.exe', ['claude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const exe = hits.find(h => /\.exe$/i.test(h));
    if (exe) return { cmd: exe, viaCmd: false };
    const cmd = hits.find(h => /\.(cmd|bat)$/i.test(h));
    if (cmd) return { cmd, viaCmd: true };
  } catch {}
  return null;
}

function quoteWin(a) {
  if (a === '') return '""';
  return /[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}

function printSummary(proxy) {
  const T = proxy.stats;
  if (!T.requests) return;
  const money = v => '$' + v.toFixed(v >= 1 ? 2 : 4);
  const totalIn = T.input + T.cacheRead + T.cacheWrite;
  console.log('\n' + c.bold('✂️  ClaudeCut session summary'));
  console.log(`   API calls:          ${T.requests}${T.errors ? c.red(`  (${T.errors} errors)`) : ''}`);
  console.log(`   Actual cost:        ${money(T.cost)}${T.unpriced ? c.dim(`  (+${T.unpriced} calls on unknown-price models)`) : ''}`);
  console.log(`   Saved by caching:   ${c.green(money(T.cacheSavings))}  (cache hit rate ${totalIn ? Math.round(100 * T.cacheRead / totalIn) : 0}%)`);
  console.log(`   Trimmed by ClaudeCut: ${T.trimmedTokens.toLocaleString()} tokens from ${T.compressedOutputs} tool outputs (≈ ${c.green(money(T.trimmedSavings))})`);
  if (T.blockedByBudget) console.log(c.yellow(`   ${T.blockedByBudget} request(s) blocked by your budget`));
  console.log(c.dim('   Details: claudecut report'));
}

async function startProxy(args, label) {
  const budgetArg = takeOption(args, '--budget');
  const budget = budgetArg !== undefined ? Number(budgetArg) : null;
  if (budgetArg !== undefined && !(budget > 0)) { console.error(c.red('--budget needs a positive number of dollars, e.g. --budget 5')); process.exit(1); }
  const port = parseInt(takeOption(args, '--port') || '9876', 10) || 9876;
  const measure = !!takeOption(args, '--measure-only', false);
  const noOpen = !!takeOption(args, '--no-open', false);
  const explicitUpstream = takeOption(args, '--upstream');
  let upstream = explicitUpstream || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
  if (!explicitUpstream && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(upstream)) {
    // A previous ClaudeCut session may have left ANTHROPIC_BASE_URL pointing at a local proxy;
    // forwarding to it would loop. Use --upstream explicitly to chain local gateways.
    upstream = 'https://api.anthropic.com';
  }

  const proxy = new ClaudeCutProxy({ port, budget, upstream, mode: measure ? 'measure' : 'optimize' });
  await proxy.start();
  console.log(c.cyan(`✂️  ClaudeCut ${measure ? '(measure-only) ' : ''}running on ${proxy.url} → ${new URL(upstream).origin}`));
  console.log(`   Live dashboard: ${c.bold(proxy.dashboardUrl)}${budget ? `   Budget: $${budget}` : ''}`);
  if (!noOpen) openBrowser(proxy.dashboardUrl);
  return proxy;
}

async function cmdRun(args) {
  const claude = resolveClaude();
  if (!claude) {
    console.error(c.red('Claude Code was not found on your PATH.'));
    console.log('Install it first: ' + c.yellow('npm install -g @anthropic-ai/claude-code'));
    process.exit(1);
  }
  const proxy = await startProxy(args);
  console.log(c.dim('   Launching Claude Code…\n'));

  const env = { ...process.env, ANTHROPIC_BASE_URL: proxy.url };
  const child = claude.viaCmd
    ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', [quoteWin(claude.cmd), ...args.map(quoteWin)].join(' ')], { env, stdio: 'inherit', windowsVerbatimArguments: true })
    : spawn(claude.cmd, args, { env, stdio: 'inherit' });

  child.on('error', err => {
    console.error(c.red(`Failed to launch Claude Code: ${err.message}`));
    proxy.stop();
    process.exit(1);
  });
  child.on('exit', code => {
    printSummary(proxy);
    proxy.stop();
    process.exit(code || 0);
  });
  // Ctrl+C goes to Claude Code (same console); we just keep running until it exits.
  process.on('SIGINT', () => {});
}

async function cmdProxy(args) {
  const proxy = await startProxy(args);
  console.log('\nPoint your app at it:');
  console.log(c.dim(process.platform === 'win32' ? `   $env:ANTHROPIC_BASE_URL="${proxy.url}"   (PowerShell)` : `   export ANTHROPIC_BASE_URL=${proxy.url}`));
  console.log(c.dim('   Press Ctrl+C to stop.'));
  const stop = () => { printSummary(proxy); proxy.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function fmtBytes(b) { return b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b > 1e3 ? (b / 1e3).toFixed(0) + ' KB' : b + ' B'; }

function cmdInit(args) {
  const root = process.cwd();
  const yes = args.includes('--yes') || args.includes('-y');
  const { projects, rules, findings } = scan(root);
  console.log(c.bold(`✂️  Scanning ${root}`));
  console.log(`   Projects found: ${projects.length}${projects.length > 1 ? c.dim(' (' + projects.slice(1, 6).join(', ') + (projects.length > 6 ? ', …' : '') + ')') : ''}`);
  if (findings.length) {
    console.log('   Bulky paths Claude Code should never read:');
    findings.sort((a, b) => b.bytes - a.bytes).slice(0, 15).forEach(f => console.log(`     ${f.path.padEnd(48)} ${c.dim(fmtBytes(f.bytes))}`));
    if (findings.length > 15) console.log(c.dim(`     …and ${findings.length - 15} more`));
  } else console.log(c.dim('   No dependency folders or lockfiles found (generic rules for minified files/logs will still be added).'));

  const target = path.join(root, '.claude', 'settings.json');
  if (!yes) {
    console.log(`\n   This will add ${rules.length} deny rules to ${c.bold(target)} (existing settings are kept).`);
    console.log(`   Run ${c.cyan('claudecut init --yes')} to apply.`);
    return;
  }
  const { file, added } = applyRules(root, rules);
  console.log(added.length ? c.green(`\n✔ Added ${added.length} rules to ${file}`) : c.green('\n✔ Already shielded: nothing to add.'));
}

function cmdReport() {
  const sessions = loadSessions(20);
  if (!sessions.length) return console.log('No sessions recorded yet. Run ' + c.cyan('claudecut') + ' first.');
  const money = v => ('$' + v.toFixed(2)).padStart(9);
  console.log(c.bold('Session'.padEnd(26) + 'Calls'.padStart(7) + 'Cost'.padStart(9) + 'Cached'.padStart(9) + 'Trimmed'.padStart(9)));
  let tot = { cost: 0, cache: 0, trim: 0 };
  for (const s of sessions) {
    console.log(s.id.slice(0, 19).replace('T', ' ').padEnd(26) + String(s.requests).padStart(7) + money(s.cost) + money(s.cacheSavings) + money(s.trimmedSavings));
    tot.cost += s.cost; tot.cache += s.cacheSavings; tot.trim += s.trimmedSavings;
  }
  console.log(c.bold('Total'.padEnd(33) + money(tot.cost) + money(tot.cache) + money(tot.trim)));
  console.log(c.dim('"Cached" = saved by prompt caching. "Trimmed" = saved by ClaudeCut output compression (estimate).'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') return console.log(HELP);
  if (args[0] === '--version' || args[0] === '-v') return console.log(`ClaudeCut v${pkg.version}`);
  if (args[0] === 'init') return cmdInit(args.slice(1));
  if (args[0] === 'report') return cmdReport();
  if (args[0] === 'proxy') return cmdProxy(args.slice(1));
  return cmdRun(args);
}

main().catch(err => {
  console.error(c.red('[ClaudeCut] ' + (err && err.message ? err.message : err)));
  process.exit(1);
});
