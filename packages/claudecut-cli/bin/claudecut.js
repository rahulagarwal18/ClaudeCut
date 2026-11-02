#!/usr/bin/env node

const { spawn } = require('child_process');
const { ClaudeCutProxy } = require('../src/proxy');
const { ensureClaudeIgnore } = require('../src/ignoreManager');

async function main() {
  const args = process.argv.slice(2);

  // Help command
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
✂️  ClaudeCut - Zero-Setup Optimizer for Claude Code (NPX Ready)

Usage:
  npx claudecut [options] [claude-args]

What it automatically does for you:
  1. Auto-configures .claudeignore to protect large projects from lockfile & build context bloat
  2. Runs a lightweight local proxy that attaches 90% off ephemeral prompt caching
  3. Minifies whitespace and repetitive token bloat
  4. Keeps Claude Code fast and inexpensive on massive repos

Options:
  --port <num>       Custom proxy port (default: 9876)
  --no-ignore        Skip auto-creating .claudeignore
  -v, --version      Show ClaudeCut version
  -h, --help         Show this help message

Examples:
  npx claudecut
  npx claudecut --resume
  npx claudecut "Fix the issue in auth service"
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    const pkg = require('../package.json');
    console.log(`ClaudeCut v${pkg.version}`);
    process.exit(0);
  }

  // Parse options
  let port = 9876;
  const portIdx = args.indexOf('--port');
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10) || 9876;
    args.splice(portIdx, 2);
  }

  const noIgnore = args.includes('--no-ignore');
  if (noIgnore) {
    args.splice(args.indexOf('--no-ignore'), 1);
  } else {
    const ignoreResult = ensureClaudeIgnore(process.cwd());
    if (ignoreResult.created) {
      console.log(`\x1b[32m✔ Auto-configured .claudeignore (shielded lockfiles & dist from context)\x1b[0m`);
    }
  }

  // Start background optimizer proxy
  const proxy = new ClaudeCutProxy({ port });
  let proxyUrl;
  try {
    proxyUrl = await proxy.start();
    console.log(`\x1b[36m✂️  ClaudeCut Optimizer Active on ${proxyUrl} (Prompt Caching 90% Off Enabled)\x1b[0m`);
  } catch (err) {
    console.warn(`\x1b[33m[Warning] Could not start proxy on port ${port} (${err.message}). Launching standard Claude...\x1b[0m`);
  }

  // Setup environment for Claude Code CLI
  const env = { ...process.env };
  if (proxyUrl) {
    env.ANTHROPIC_BASE_URL = proxyUrl;
  }

  console.log(`\x1b[90mLaunching Claude Code...\x1b[0m\n`);

  // Detect shell executable on Windows vs Unix
  const isWin = process.platform === 'win32';
  const claudeCmd = isWin ? 'claude.cmd' : 'claude';

  // Spawn claude with user arguments and stdio inheritance
  const child = spawn(claudeCmd, args, {
    env,
    stdio: 'inherit',
    shell: true
  });

  child.on('error', err => {
    if (err.code === 'ENOENT') {
      console.error(`\x1b[31m[Error] Claude Code is not installed.\x1b[0m`);
      console.log(`Please install Claude Code first by running:`);
      console.log(`\x1b[33mnpm install -g @anthropic-ai/claude-code\x1b[0m`);
    } else {
      console.error(`Failed to launch Claude Code:`, err.message);
    }
    proxy.stop();
    process.exit(1);
  });

  child.on('exit', code => {
    proxy.stop();
    if (proxy.stats.totalRequests > 0) {
      console.log(`\n\x1b[32m✂️  ClaudeCut Session Finished. Handled ${proxy.stats.totalRequests} API calls with automated caching optimization.\x1b[0m`);
    }
    process.exit(code || 0);
  });

  // Handle clean exit on Ctrl+C / SIGINT
  process.on('SIGINT', () => {
    proxy.stop();
    child.kill('SIGINT');
  });

  process.on('SIGTERM', () => {
    proxy.stop();
    child.kill('SIGTERM');
  });
}

main().catch(err => {
  console.error('[Error]', err);
  process.exit(1);
});
