# ✂️ ClaudeCut

**See and cut what Claude Code costs on big codebases.**

ClaudeCut runs Claude Code through a small local proxy. It shows you live where every token and dollar goes, trims noisy tool output before it reaches the model, stops a session at a budget you choose, and keeps lockfiles and build output out of Claude's context.

```bash
npx claudecut              # run Claude Code through ClaudeCut
npx claudecut --budget 5   # ...and stop at $5
```

A live dashboard opens at `http://127.0.0.1:9876/__claudecut`.

## What you see

| Panel | What it tells you |
|---|---|
| **Session cost** | Real cost of every call, from the `usage` numbers Anthropic returns (not estimates) |
| **Saved by prompt caching** | What caching saved compared with paying full price for every input token |
| **Trimmed by ClaudeCut** | Tokens of noisy tool output removed, valued at the rate you actually paid |
| **Cache hit rate** | Share of input tokens served from cache (~10% of the normal price) |
| **Budget** | Spend against your limit; new requests are blocked once it's reached |
| **Tokens per request** | One bar per API call: cache read / cache write / uncached / output |
| **What's filling the context** | Which files and commands take up the most room in the context window |
| **What ClaudeCut did** | Every action it took, e.g. `Bash npm test: ≈15k → ≈777 tokens` |

## What it does to requests (and what it never does)

**Does:**
- **Compresses huge tool output** (test runs, build logs, `grep`/`find` results): keeps the first and last 80 lines plus every error or warning line from the middle, strips ANSI colour codes, and collapses repeated lines.
- **Adds prompt-cache breakpoints** only when the client hasn't set any, and never more than the API limit of 4.

**Never does:**
- Never edits Claude's own earlier messages. On current models that would break preserved thinking.
- Never rewrites `Read`/`Edit`/`Write` results. Claude needs exact file contents to edit them.
- Never drops messages from history.
- Never changes anything based on a message's position in the conversation. Every change depends only on the content, so the same output is trimmed identically on every turn and the prompt cache keeps hitting.

Want proof before trusting it? Run `npx claudecut --measure-only`: requests pass through byte-for-byte and the dashboard only *measures*.

## VS Code (Claude Code panel)

In your project folder, run once:

```bash
npx claudecut vscode            # optional: --budget 5
```

Then reload VS Code (`Ctrl+Shift+P` → "Developer: Reload Window") and click **Allow** if VS Code asks about automatic tasks. From then on, ClaudeCut starts by itself whenever you open the folder, and the Claude Code panel goes through it. Dashboard: `http://127.0.0.1:9876/__claudecut`.

Undo with `npx claudecut vscode --remove`.

## Big repos and monorepos

```bash
npx claudecut init          # preview
npx claudecut init --yes    # apply
```

Scans the repo and its sub-projects (`apps/*`, `services/*`, …) for `node_modules`, `.venv`, `dist`, `.next`, lockfiles, minified files and logs. It then adds Claude Code permission rules such as `Read(./package-lock.json)` to `.claude/settings.json`, so Claude Code never reads them. Existing settings are kept.

## Commands

```
claudecut [options] [claude args]   Run Claude Code through ClaudeCut
claudecut proxy [options]           Proxy only (Anthropic SDK apps, other tools)
claudecut init [--yes]              Big-repo context shield
claudecut report                    Cost summary of recent sessions

--budget <usd>     Block new requests once the session has spent this much
--measure-only     Change nothing; only measure
--port <num>       Preferred port (default 9876; next free one is used if busy)
--upstream <url>   Forward to another base URL (default $ANTHROPIC_BASE_URL or Anthropic)
--no-open          Don't open the dashboard automatically
```

For your own apps: run `claudecut proxy` and set `ANTHROPIC_BASE_URL=http://127.0.0.1:9876`.

## Notes

- **Privacy:** everything runs on your machine. Session metrics (token counts, costs, tool names, file paths/commands) are saved to `~/.claudecut/sessions/`. Prompt contents are never stored.
- **Subscriptions:** if you use Claude Code with a Pro/Max plan, you aren't billed per token; the dashboard shows the equivalent API cost.
- **Pricing** lives in `src/pricing.js`. Models it doesn't know still pass through; their cost shows as unknown.
- Requires Node 18+ and Claude Code (`npm install -g @anthropic-ai/claude-code`).

## Development

```bash
cd packages/claudecut-cli
npm test
```

The tests run requests through a mock Anthropic API that rejects whatever the real API rejects (too many cache breakpoints, orphaned tool results).
