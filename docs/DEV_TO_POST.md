---
title: How I Legally Slashed Anthropic Claude API & Claude Code Bills by 70%
published: true
tags: ai, python, opensource, programming
canonical_url: https://github.com/rahulagarwal18/ClaudeCut
cover_image: https://raw.githubusercontent.com/rahulagarwal18/ClaudeCut/main/assets/hero_banner.jpg
---

If you have been building with **Claude Code**, **Cursor**, or autonomous agentic workflows over the past few months, you've probably felt the sting of runaway Anthropic API bills.

A few days of multi-turn coding sessions can easily run up hundreds of dollars in token usage.

Today, I'm open-sourcing **[ClaudeCut](https://github.com/rahulagarwal18/ClaudeCut)** — a lightweight local reverse proxy that automatically reduces Anthropic Claude API expenses by **40% to 70%** without sacrificing code quality or model intelligence.

Here is the exact engineering behind how it works.

---

## ⚡ The Root Problem: Why Claude Gets Expensive

When you use Claude in an IDE or CLI, your client sends:
1. The **entire repository structure & opened files**
2. The **developer rules / system instructions**
3. The **full tool definition schemas**
4. The **entire multi-turn conversation history**

Every single time you send a message, your tool re-sends that entire 30,000+ token context from scratch.

By default, Anthropic bills input tokens at standard full rates:
* **Claude 3.7 / 3.5 Sonnet:** $3.00 per million input tokens
* **Claude Opus:** $15.00 per million input tokens

### The "Hidden" 90% Discount
Anthropic offers **Prompt Caching**, which discounts cached input tokens by **90%** ($0.30/M on Sonnet).

**The catch:** To get this discount, requests must contain explicit `cache_control: {"type": "ephemeral"}` breakpoints. In standard setups, developers don't configure these breakpoints manually, so they pay full price every turn.

---

## 💡 How ClaudeCut Solves This

ClaudeCut is a drop-in local proxy that sits seamlessly between your IDE / CLI and Anthropic:

![ClaudeCut Architecture](https://raw.githubusercontent.com/rahulagarwal18/ClaudeCut/main/assets/architecture_diagram.jpg)

### 1️⃣ Automated Ephemeral Prompt Caching (90% Off)
ClaudeCut dynamically intercepts incoming payload requests and places up to 4 cache breakpoints (Anthropic's maximum limit):
* System instructions
* Tool definition schemas
* Multi-turn chat checkpoints

Claude recognizes the cache bookmarks and automatically applies the **90% discount** on all repeat context.

### 2️⃣ Dynamic Task-Based Model Switching
Why pay flagship rates to write a 1-line git commit message or fix a typo?
ClaudeCut inspects task heuristics in real-time:
* **Tier 1 (Lightweight / 90% cheaper):** Formats, typo fixes, git commit messages, regex, syntax checks ➔ Routed to **Claude 3.5 Haiku**
* **Tier 2 (Standard Workhorse):** Feature coding, refactoring, multi-file edits, unit tests ➔ **Claude 3.7 Sonnet**
* **Tier 3 (Deep Reasoning):** Architecture design, formal verification, security audits ➔ **Claude Opus**

### 3️⃣ Context & Whitespace Minification
Strips redundant delimiters, blank lines, and trailing whitespace bloat before tokenization (saving 10%–25% tokens without breaking syntax).

### 4️⃣ Real-Time Financial Dashboard
Runs a local dashboard at `http://localhost:8000/dashboard` displaying live dollars saved, actual API spend, cache hit ratios, and model tier distribution.

---

## 📊 The Math: 10-Turn Benchmark

Here is a real comparison on a 10-turn coding session with 35,000 context tokens:

| Setup | Input Tokens | Cache Reads (90% OFF) | Output Tokens | Total Cost |
| :--- | :--- | :--- | :--- | :--- |
| **Standard Claude (Direct)** | 360,000 | 0 | 6,000 | **$1.170** |
| **With ClaudeCut Optimizer** | 10,000 | 315,000 | 6,000 | **$0.346** |
| **Net Cost Reduction** | — | — | — | **🔥 70.38% SAVED** |

---

## 🚀 Quickstart in 60 Seconds

### 1. Clone & Run ClaudeCut
```bash
git clone https://github.com/rahulagarwal18/ClaudeCut.git
cd ClaudeCut
pip install -r requirements.txt
python -m claudecut.cli start
```

### 2. Connect Claude Code CLI
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8000"
claude
```

### 3. Connect Python SDK / Cursor
```python
import anthropic

client = anthropic.Anthropic(
    base_url="http://127.0.0.1:8000"
)
```

---

## 🔗 Try It Out & Star the Repo!

The project is live on GitHub:
👉 **[github.com/rahulagarwal18/ClaudeCut](https://github.com/rahulagarwal18/ClaudeCut)**

If this saved you money on your Claude bills, consider dropping a ⭐ on GitHub!

What are your favorite techniques for optimizing LLM inference costs? Let's discuss in the comments below! 👇
