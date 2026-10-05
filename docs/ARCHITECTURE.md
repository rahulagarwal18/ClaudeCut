# ClaudeCut Architecture & Technical Specifications

## 1. Overview
**ClaudeCut** is an open-source, non-intrusive reverse proxy that sits between your AI clients (e.g., Claude Code, Cursor, Python/Node apps) and Anthropic's Messages API (`https://api.anthropic.com/v1/messages`).

Its purpose is to reduce overall Anthropic billing by **40% to 70%** without degrading generation quality or model intelligence.

```
┌────────────────────────────────────────────────────────┐
│             Your Development Client                   │
│   (Claude Code CLI / Cursor / Python SDK / App)        │
└─────────────────────────┬──────────────────────────────┘
                          │
                          │ HTTP / SSE POST /v1/messages
                          ▼
┌────────────────────────────────────────────────────────┐
│                   ClaudeCut Proxy                      │
│                                                        │
│  1. Exact Hash Cache Check (Deterministic matching)    │
│  2. Context Minification (Strips redundant whitespace)  │
│  3. Smart Intent Router (Haiku cascade for micro-tasks)│
│  4. Auto Ephemeral Prompt Cache Injector               │
│  5. Real-Time Token & Dollar Savings Analytics         │
└─────────────────────────┬──────────────────────────────┘
                          │
                          │ Optimized Request (90% Cache Discounts)
                          ▼
┌────────────────────────────────────────────────────────┐
│               Anthropic Official API                   │
│             (api.anthropic.com/v1/messages)            │
└────────────────────────────────────────────────────────┘
```

---

## 2. Core Optimization Engines

### A. Automated Ephemeral Prompt Cache Injector
Anthropic offers **Prompt Caching**, which provides a **90% discount** on cached input tokens ($0.30/M on Sonnet vs. $3.00/M standard input).

However, manual caching requires developers to explicitly annotate blocks with `cache_control: {"type": "ephemeral"}`. In standard coding sessions, developers send entire files and message logs uncached, incurring massive full-price token penalties on every turn.

**How ClaudeCut Solves This:**
1. Intercepts incoming messages payloads.
2. Analyzes the token payload size.
3. Strategically places up to 4 cache breakpoints (Anthropic's maximum limit):
   - **System Prompt:** Cached across all requests.
   - **Tools Definition:** The last tool schema is cached, ensuring all preceding tool schemas are reused at 90% discount.
   - **Historical Conversation Checkpoints:** Automatically caches turns prior to the latest prompt.

### B. AST Context Pruner & Minifier
Large project files and stack traces frequently carry trailing whitespace, long lines of repetitive separator characters (`====`), and excess empty lines. 
ClaudeCut normalizes and compresses payload structures without altering syntax semantics, reducing payload size by 10%–25% before tokenization.

### C. Smart Intent Routing (Optional)
When enabled, ClaudeCut examines incoming prompt heuristics. Lightweight utility calls (e.g. `generate a commit message`, formatting JSON, simple regex) are transparently routed to `claude-3-5-haiku`, saving 90% per request compared to flagship models.

### D. SQLite Real-Time Cost Ledger
Every request and SSE stream is parsed for Anthropic usage headers (`cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`, `output_tokens`). The exact dollar spend is compared against baseline uncached pricing, giving you verifiable financial analytics.
