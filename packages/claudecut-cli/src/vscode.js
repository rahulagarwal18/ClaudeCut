/**
 * `claudecut vscode` - make the Claude Code panel in VS Code go through ClaudeCut.
 *
 *  1. .vscode/tasks.json      a background task that starts the ClaudeCut proxy
 *                             automatically when the folder is opened
 *  2. .claude/settings.local.json   env ANTHROPIC_BASE_URL -> the proxy, so the
 *                             Claude Code panel (and `claude` in that folder) use it
 *
 * Existing settings are merged, never replaced. `--remove` undoes both.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TASK_LABEL = 'ClaudeCut';

function readJson(file) {
  if (!fs.existsSync(file)) return { data: {}, existed: false };
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return { data: raw.trim() ? JSON.parse(raw) : {}, existed: true };
  } catch {
    // tasks.json often has comments; rewriting would delete them, so refuse.
    throw new Error(`${file} has comments or is not plain JSON. Add the ClaudeCut task by hand (see "claudecut vscode --print").`);
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function hasGlobalClaudecut() {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claudecut'], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

function makeTask(port, budget) {
  const proxyArgs = ['proxy', '--port', String(port), '--strict-port', '--no-open', ...(budget ? ['--budget', String(budget)] : [])];
  const useGlobal = hasGlobalClaudecut();
  return {
    label: TASK_LABEL,
    type: 'shell',
    command: useGlobal ? 'claudecut' : 'npx',
    args: useGlobal ? proxyArgs : ['-y', 'claudecut', ...proxyArgs],
    isBackground: true,
    problemMatcher: {
      owner: 'claudecut',
      pattern: { regexp: '^__claudecut_never_matches__$' },
      background: { activeBegin: true, beginsPattern: 'ClaudeCut', endsPattern: '(running on|already running)' }
    },
    presentation: { reveal: 'silent', panel: 'dedicated', clear: true },
    runOptions: { runOn: 'folderOpen' }
  };
}

function setup(root, { port = 9876, budget = null } = {}) {
  const tasksFile = path.join(root, '.vscode', 'tasks.json');
  const settingsFile = path.join(root, '.claude', 'settings.local.json');

  const tasks = readJson(tasksFile).data;
  tasks.version = tasks.version || '2.0.0';
  tasks.tasks = (Array.isArray(tasks.tasks) ? tasks.tasks : []).filter(t => t && t.label !== TASK_LABEL);
  tasks.tasks.push(makeTask(port, budget));

  const settings = readJson(settingsFile).data;
  settings.env = { ...(settings.env || {}), ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` };

  writeJson(tasksFile, tasks);
  writeJson(settingsFile, settings);
  return { tasksFile, settingsFile, url: `http://127.0.0.1:${port}` };
}

function remove(root) {
  const tasksFile = path.join(root, '.vscode', 'tasks.json');
  const settingsFile = path.join(root, '.claude', 'settings.local.json');
  const changed = [];
  if (fs.existsSync(tasksFile)) {
    const tasks = readJson(tasksFile).data;
    const before = (tasks.tasks || []).length;
    tasks.tasks = (tasks.tasks || []).filter(t => t && t.label !== TASK_LABEL);
    if (tasks.tasks.length !== before) { writeJson(tasksFile, tasks); changed.push(tasksFile); }
  }
  if (fs.existsSync(settingsFile)) {
    const settings = readJson(settingsFile).data;
    if (settings.env && /^http:\/\/127\.0\.0\.1:\d+$/.test(settings.env.ANTHROPIC_BASE_URL || '')) {
      delete settings.env.ANTHROPIC_BASE_URL;
      if (!Object.keys(settings.env).length) delete settings.env;
      writeJson(settingsFile, settings);
      changed.push(settingsFile);
    }
  }
  return changed;
}

module.exports = { setup, remove, makeTask };
