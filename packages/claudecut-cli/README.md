# ✂️ ClaudeCut CLI (`npx claudecut`)

Zero-setup optimizer and smart wrapper for **Claude Code** (`@anthropic-ai/claude-code`).
Solves context idle bloat, reduces token bills by 40% to 70%, and protects large projects via automated `.claudeignore` and dynamic prompt caching.

## 🚀 Instant Usage (No Installation Needed)

Simply run in any project repository:

```bash
npx claudecut
```

Or pass any standard Claude Code arguments directly:

```bash
npx claudecut --resume
npx claudecut "Fix the issue in user controller"
```

---

## ⚡ What It Solves For Large Projects

### 1. Context Idle & Lockfile Bloat
In big projects, Claude Code accidentally indexes massive lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`) and build outputs (`dist/`, `.next/`), inflating context by 50,000+ tokens on day one.
`npx claudecut` auto-generates a smart `.claudeignore` to prevent this without touching your git tracking.

### 2. Automated 90% Off Ephemeral Prompt Caching
ClaudeCut runs an invisible, zero-latency local proxy that sets Anthropic's official `cache_control: {"type": "ephemeral"}` breakpoints on:
* System instructions
* Tool definition schemas
* Historical turns

Every repeat read is billed at **$0.30/M instead of $3.00/M** (90% discount).

### 3. Minification
Compresses trailing line spaces, repetitive delimiter logs (`======`), and excessive empty lines before sending to the model.

---

## 🛠️ CLI Options

| Option | Description |
| :--- | :--- |
| `--port <num>` | Use custom local proxy port (default: `9876`) |
| `--no-ignore` | Skip auto-generating `.claudeignore` |
| `-v, --version` | Output version |
| `-h, --help` | Display help |

---

## 📦 Publishing to npm (For Maintainer)

```bash
cd B:\AI_Projects\claudecut-cli
npm publish
```
Once published to npm, anyone in the world can run:
`npx claudecut`
