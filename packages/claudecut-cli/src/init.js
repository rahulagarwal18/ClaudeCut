/**
 * `claudecut init` - big-repo shield.
 *
 * Scans the project (and sub-projects in a monorepo) for lockfiles, dependency
 * folders, build output and other bulky files, then adds Claude Code permission
 * deny rules like  Read(./package-lock.json)  to .claude/settings.json so Claude
 * Code never pulls them into context. Existing settings are merged, never replaced.
 */
const fs = require('fs');
const path = require('path');

const DIRS = ['node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo',
  '.cache', 'coverage', 'target', '.gradle', 'Pods', 'DerivedData', '.terraform', 'bower_components'];
const FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'poetry.lock', 'Pipfile.lock', 'uv.lock',
  'Cargo.lock', 'composer.lock', 'Gemfile.lock', 'go.sum', 'Podfile.lock', 'packages.lock.json'];
const GLOBS = ['**/*.min.js', '**/*.min.css', '**/*.map', '**/*.log', '**/*.sqlite', '**/*.db'];
const SKIP = new Set(['.git', ...DIRS]);
const MARKERS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile'];

function toRel(root, p) {
  const rel = path.relative(root, p).split(path.sep).join('/');
  return rel ? `./${rel}` : '.';
}

/** Find the project root plus sub-projects up to `depth` levels deep. */
function findProjects(root, depth = 3) {
  const found = [root];
  const walk = (dir, d) => {
    if (d > depth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (MARKERS.some(m => fs.existsSync(path.join(full, m)))) found.push(full);
      walk(full, d + 1);
    }
  };
  walk(root, 1);
  return found;
}

function dirSize(dir, budget = { files: 20000 }) {
  let bytes = 0;
  const stack = [dir];
  while (stack.length && budget.files > 0) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else { budget.files--; try { bytes += fs.statSync(full).size; } catch {} }
    }
  }
  return bytes;
}

function scan(root = process.cwd()) {
  const projects = findProjects(root);
  const rules = [];
  const findings = [];
  for (const proj of projects) {
    for (const d of DIRS) {
      const p = path.join(proj, d);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        rules.push(`Read(${toRel(root, p)}/**)`);
        findings.push({ path: toRel(root, p) + '/', bytes: dirSize(p) });
      }
    }
    for (const f of FILES) {
      const p = path.join(proj, f);
      if (fs.existsSync(p)) {
        rules.push(`Read(${toRel(root, p)})`);
        findings.push({ path: toRel(root, p), bytes: fs.statSync(p).size });
      }
    }
  }
  for (const g of GLOBS) rules.push(`Read(./${g})`);
  return { projects: projects.map(p => toRel(root, p)), rules: [...new Set(rules)], findings };
}

function applyRules(root, rules) {
  const dir = path.join(root, '.claude');
  const file = path.join(dir, 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { throw new Error(`${file} is not valid JSON; fix it first (${e.message})`); }
  }
  settings.permissions = settings.permissions || {};
  const deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
  const added = rules.filter(r => !deny.includes(r));
  settings.permissions.deny = [...deny, ...added];
  if (added.length) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }
  return { file, added };
}

module.exports = { scan, applyRules, findProjects };
