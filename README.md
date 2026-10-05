# ✂️ ClaudeCut

> **Open-Source Intelligent Reverse Proxy that automatically reduces Anthropic Claude API & Claude Code expenses by 40% to 70%.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/Framework-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![Savings](https://img.shields.io/badge/Average_Cost_Savings-40%25_to_70%25-green.svg)](docs/BENCHMARKS.md)

---

## ⚡ The Problem

When using tools like **Claude Code**, **Cursor**, or custom AI applications, developers send large codebases, system prompts, tool schemas, and conversation history on **every single turn**.

By default, Anthropic bills standard input tokens at full price ($3.00/M on Sonnet, $15.00/M on Opus). Even though Anthropic offers **Prompt Caching** (which gives a **90% discount** at $0.30/M), most tools and scripts do not automatically configure optimal cache breakpoints—resulting in inflated monthly invoices.

---

## 💡 The Solution: ClaudeCut

**ClaudeCut** is a lightweight, drop-in local proxy that sits seamlessly between your IDE / Claude Code CLI / app and Anthropic:

```
[ Claude Code / Cursor / Your App ]
                │
                ▼ (HTTP / SSE)
     [ ✂️ ClaudeCut Local Proxy ] ──▶ Automatically injects ephemeral prompt caches,
                │                    prunes whitespace/token bloat, & routes simple tasks
                ▼
     [ Anthropic Official API ]  ──▶ Billed at 90% discount on cached reads!
```

### ✨ Key Features:
1. **Automated Ephemeral Prompt Caching:** Dynamically places up to 4 cache breakpoints across system prompts, tool schemas, and multi-turn history turns to trigger Anthropic's **90% cached token discount**.
2. **Dynamic Task-Based Model Switching (Auto-Routing):** Classifies prompt intent in real time:
   - **Tier 1 (Lightweight / 90% cheaper):** Formats, typo fixes, git commit messages, regex, syntax checks $\rightarrow$ dynamically routed to **Claude 3.5 Haiku**.
   - **Tier 2 (Standard Workhorse):** Feature coding, refactoring, multi-file edits, unit tests $\rightarrow$ routed to **Claude 3.7 Sonnet**.
   - **Tier 3 (Deep Reasoning):** Architecture design, formal verification, security audits $\rightarrow$ routed to **Claude Opus**.
3. **Context Minification:** Strips redundant whitespace, repetitive delimiters, and trailing formatting without breaking syntax semantics (saving 10%–25% tokens).
4. **Deterministic Hash Cache:** Exact match local caching for identical requests / temperature=0 calls.
5. **Real-Time Financial Dashboard:** Built-in web UI at `http://localhost:8000/dashboard` showing live money saved, cache hit ratio, token analytics, and model tier breakdown.

---

## 🚀 Quickstart in 60 Seconds

### 1. Clone & Install
```bash
git clone https://github.com/open-claudecut/claudecut.git
cd claudecut
pip install -r requirements.txt
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(Optional: add `ANTHROPIC_API_KEY=your_key_here` in `.env`, or let your client pass it via headers).*

### 3. Start the Optimizer Proxy
```bash
python -m claudecut.cli start
```
The server will boot at `http://127.0.0.1:8000` with the live dashboard accessible at `http://127.0.0.1:8000/dashboard`.

---

## 🔌 Hooking Up Your Tools

### With Claude Code CLI:
```bash
# Point Claude Code to ClaudeCut
export ANTHROPIC_BASE_URL="http://127.0.0.1:8000"
claude
```

### With Python SDK:
```python
import anthropic

client = anthropic.Anthropic(
    api_key="your-key",
    base_url="http://127.0.0.1:8000"
)
```

*(See [docs/INTEGRATION_GUIDE.md](docs/INTEGRATION_GUIDE.md) for Cursor, TypeScript, Continue.dev, and LangChain).*

---

## 📊 Benchmarks & Math

On a standard 10-turn coding session with a 35,000 token context:
* **Standard Uncached Cost:** \$1.170
* **ClaudeCut Cost:** \$0.3465
* **Net Savings:** **70.38% reduction**

Check out [docs/BENCHMARKS.md](docs/BENCHMARKS.md) for full mathematical proofs and pricing breakdowns.

---

## 📚 Documentation
* 🏗️ [Architecture & Technical Specifications](docs/ARCHITECTURE.md)
* 📈 [Pricing & Benchmarks](docs/BENCHMARKS.md)
* 🔌 [Integration Guide (Claude Code, Cursor, SDKs)](docs/INTEGRATION_GUIDE.md)

---

## 📄 License
This project is open-source under the [MIT License](LICENSE).
