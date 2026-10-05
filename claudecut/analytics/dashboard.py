"""
Web Dashboard for ClaudeCut.
Provides clean UI to visualize real-time cost savings, token analytics, and dynamic model routing.
"""

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ClaudeCut - AI Cost Optimizer Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
    <div class="max-w-6xl mx-auto px-4 py-8">
        <!-- Header -->
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-800 pb-6 mb-8 gap-4">
            <div>
                <div class="flex items-center gap-3">
                    <span class="text-3xl">✂️</span>
                    <h1 class="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">ClaudeCut Optimizer</h1>
                    <span class="bg-emerald-950 text-emerald-400 text-xs px-2.5 py-1 rounded-full border border-emerald-800 font-semibold">Active Proxy</span>
                </div>
                <p class="text-sm text-slate-400 mt-1">Automated Prompt Cache Injection + Dynamic Task-Based Model Switching</p>
            </div>
            <div class="flex items-center gap-3">
                <a href="https://github.com/rahulagarwal18/ClaudeCut" target="_blank" class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs px-3 py-2 rounded-lg transition">⭐ Star on GitHub</a>
                <button onclick="fetchStats()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-2 rounded-lg font-medium transition">↻ Refresh</button>
            </div>
        </div>

        <!-- Metric Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Savings</span>
                <div class="text-3xl font-extrabold text-emerald-400 mt-2" id="savedUsd">$0.0000</div>
                <div class="text-xs text-emerald-400/80 mt-1 flex items-center gap-1 font-medium">
                    <span id="savingsPct">0%</span> cheaper than standard Claude
                </div>
            </div>

            <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Actual API Spend</span>
                <div class="text-3xl font-extrabold text-slate-100 mt-2" id="actualCost">$0.0000</div>
                <div class="text-xs text-slate-500 mt-1">
                    Baseline was <span class="line-through" id="baselineCost">$0.0000</span>
                </div>
            </div>

            <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cache Hit Ratio</span>
                <div class="text-3xl font-extrabold text-cyan-400 mt-2" id="cacheRatio">0%</div>
                <div class="text-xs text-slate-400 mt-1">Tokens read at 90% discount</div>
            </div>

            <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">Requests Processed</span>
                <div class="text-3xl font-extrabold text-purple-400 mt-2" id="totalReqs">0</div>
                <div class="text-xs text-slate-400 mt-1"><span id="totalTokens">0</span> tokens total</div>
            </div>
        </div>

        <!-- Task-Based Auto Model Routing Card -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-8">
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-semibold text-slate-100 flex items-center gap-2">
                    <span>🧠</span> Dynamic Model Switching Breakdown
                </h2>
                <span class="text-xs bg-cyan-950 text-cyan-400 px-2.5 py-1 rounded-full border border-cyan-800 font-medium">Auto Task Classifier</span>
            </div>
            <p class="text-sm text-slate-400 mb-4">Simple queries are dynamically routed to lightweight models, keeping flagship models for deep logic:</p>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4" id="modelTiersContainer">
                <div class="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-xs font-bold text-emerald-400">Tier 1: Claude 3.5 Haiku</span>
                        <span class="text-xs text-slate-500">90% Cheaper</span>
                    </div>
                    <div class="text-xl font-bold text-slate-100" id="tierHaikuCount">0 reqs</div>
                    <span class="text-xs text-slate-400">Formatting, typos, commits, regex</span>
                </div>

                <div class="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-xs font-bold text-cyan-400">Tier 2: Claude 3.7 Sonnet</span>
                        <span class="text-xs text-slate-500">Workhorse</span>
                    </div>
                    <div class="text-xl font-bold text-slate-100" id="tierSonnetCount">0 reqs</div>
                    <span class="text-xs text-slate-400">Coding, refactoring, agent tools</span>
                </div>

                <div class="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div class="flex justify-between items-center mb-1">
                        <span class="text-xs font-bold text-purple-400">Tier 3: Claude Opus</span>
                        <span class="text-xs text-slate-500">Deep Reasoning</span>
                    </div>
                    <div class="text-xl font-bold text-slate-100" id="tierOpusCount">0 reqs</div>
                    <span class="text-xs text-slate-400">Architecture, proofs, security audits</span>
                </div>
            </div>
        </div>

        <!-- Quick Integration Instructions -->
        <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-8">
            <h2 class="text-lg font-semibold text-slate-100 mb-3 flex items-center gap-2">
                <span>🚀</span> Connect Claude Code / Cursor in 5 Seconds
            </h2>
            <p class="text-sm text-slate-400 mb-4">Route your tools through ClaudeCut to automatically enable 90% prompt caching & auto-model selection:</p>
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span class="text-xs font-semibold text-emerald-400 block mb-2">Option 1: Claude Code CLI</span>
                    <pre class="bg-slate-900 p-2.5 rounded text-xs text-slate-300 font-mono overflow-x-auto">export ANTHROPIC_BASE_URL="http://127.0.0.1:8000"
claude</pre>
                </div>
                <div class="bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <span class="text-xs font-semibold text-cyan-400 block mb-2">Option 2: Python SDK / Cursor</span>
                    <pre class="bg-slate-900 p-2.5 rounded text-xs text-slate-300 font-mono overflow-x-auto">import anthropic
client = anthropic.Anthropic(
    base_url="http://127.0.0.1:8000"
)</pre>
                </div>
            </div>
        </div>
    </div>

    <script>
        async function fetchStats() {
            try {
                const res = await fetch('/api/stats');
                const data = await res.json();
                document.getElementById('savedUsd').textContent = '$' + (data.total_saved_usd || 0).toFixed(4);
                document.getElementById('savingsPct').textContent = (data.savings_percent || 0).toFixed(1) + '%';
                document.getElementById('actualCost').textContent = '$' + (data.actual_cost_usd || 0).toFixed(4);
                document.getElementById('baselineCost').textContent = '$' + (data.baseline_cost_usd || 0).toFixed(4);
                document.getElementById('cacheRatio').textContent = (data.cache_hit_ratio || 0).toFixed(1) + '%';
                document.getElementById('totalReqs').textContent = (data.total_requests || 0).toLocaleString();
                document.getElementById('totalTokens').textContent = (data.total_tokens_processed || 0).toLocaleString();

                const breakdown = data.model_breakdown || {};
                let haiku = 0, sonnet = 0, opus = 0;
                for (const [m, count] of Object.entries(breakdown)) {
                    if (m.includes('haiku')) haiku += count;
                    else if (m.includes('opus')) opus += count;
                    else sonnet += count;
                }
                document.getElementById('tierHaikuCount').textContent = haiku.toLocaleString() + ' reqs';
                document.getElementById('tierSonnetCount').textContent = sonnet.toLocaleString() + ' reqs';
                document.getElementById('tierOpusCount').textContent = opus.toLocaleString() + ' reqs';
            } catch (err) {
                console.error("Failed to fetch stats:", err);
            }
        }
        fetchStats();
        setInterval(fetchStats, 5000);
    </script>
</body>
</html>
"""
