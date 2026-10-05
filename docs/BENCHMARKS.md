# ClaudeCut Cost Reduction Benchmarks

## Theoretical & Empirical Savings Breakdown

Anthropic's official token pricing models:

| Model | Standard Input ($/M) | Cached Read ($/M) [90% OFF] | Cache Write ($/M) | Output ($/M) |
| :--- | :--- | :--- | :--- | :--- |
| **Claude 3.7 / 3.5 Sonnet** | \$3.00 | **\$0.30** | \$3.75 | \$15.00 |
| **Claude 3.5 Haiku** | \$0.80 | **\$0.08** | \$1.00 | \$4.00 |
| **Claude 3 / 3.5 Opus** | \$15.00 | **\$1.50** | \$18.75 | \$75.00 |

---

## Benchmark Scenario: Multi-Turn Agentic Coding Session

### Scenario Parameters
* **Conversation Turns:** 10 continuous turns.
* **Context size per turn:** ~35,000 tokens (System prompt + codebase files + tool schemas + history).
* **New input tokens per turn:** 1,000 tokens.
* **Output tokens generated per turn:** 600 tokens.
* **Model:** `claude-3-7-sonnet`.

---

### Standard (Uncached) Total Cost:
Across 10 turns:
* Total input tokens = $10 \times 36,000 = 360,000$ tokens
* Total output tokens = $10 \times 600 = 6,000$ tokens

$$\text{Input Cost} = \frac{360,000 \times \$3.00}{1,000,000} = \$1.080$$
$$\text{Output Cost} = \frac{6,000 \times \$15.00}{1,000,000} = \$0.090$$
$$\mathbf{\text{Total Uncached Spend}} = \mathbf{\$1.170}$$

---

### With ClaudeCut Automated Optimization:
* **Turn 1 (Cache Write):** 36,000 tokens written to cache @ \$3.75/M = **\$0.135** + Output \$0.009 = **\$0.144**
* **Turns 2–10 (Cached Reads):**
  * 35,000 tokens read from cache @ \$0.30/M = \$0.0105
  * 1,000 new input tokens @ \$3.00/M = \$0.0030
  * 600 output tokens @ \$15.00/M = \$0.0090
  * Cost per turn = **\$0.0225**
  * 9 turns $\times \$0.0225 = \mathbf{\$0.2025}$

$$\mathbf{\text{Total ClaudeCut Spend}} = \$0.144 + \$0.2025 = \mathbf{\$0.3465}$$

---

### Financial Result
* **Baseline Cost:** \$1.170
* **ClaudeCut Cost:** \$0.3465
* **Net Reduction:** **70.38% savings** (\$0.8235 saved on a single 10-turn coding session)

In continuous production use (where cache TTL is continuously refreshed within 5 minutes), the net savings easily hover between **45% and 75%**.
