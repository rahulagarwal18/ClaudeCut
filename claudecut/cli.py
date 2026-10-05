"""
ClaudeCut Command Line Interface.
"""

import sys
import argparse
import uvicorn
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from .config import settings
from .analytics.tracker import CostTracker

console = Console()

def run_server(host: str = None, port: int = None):
    host = host or settings.HOST
    port = port or settings.PORT
    
    console.print(Panel.fit(
        f"[bold cyan]✂️ ClaudeCut AI Proxy v1.0.0[/bold cyan]\n"
        f"[green]Listening on:[/green] http://{host}:{port}\n"
        f"[green]Dashboard:[/green]    http://{host}:{port}/dashboard\n"
        f"[yellow]Features Active:[/yellow] Auto-Prompt Caching (90% off), Context Pruning, Exact Cache",
        title="[bold green]Server Started[/bold green]",
        border_style="green"
    ))
    uvicorn.run("claudecut.server:app", host=host, port=port, reload=False)

def show_stats():
    tracker = CostTracker(db_path=settings.DATABASE_PATH)
    stats = tracker.get_summary_stats()

    table = Table(title="ClaudeCut Real-World Savings Summary", show_header=True, header_style="bold magenta")
    table.add_column("Metric", style="dim")
    table.add_column("Value", justify="right", style="bold cyan")

    table.add_row("Total Requests Processed", str(stats["total_requests"]))
    table.add_row("Total Tokens Processed", f"{stats['total_tokens_processed']:,}")
    table.add_row("Cached Read Tokens", f"{stats['cached_read_tokens']:,}")
    table.add_row("Cache Hit Ratio", f"{stats['cache_hit_ratio']}%")
    table.add_row("Baseline Cost (Standard Claude)", f"${stats['baseline_cost_usd']:.4f}")
    table.add_row("Actual Invoiced Cost", f"${stats['actual_cost_usd']:.4f}")
    table.add_row("Total Money Saved", f"[bold green]${stats['total_saved_usd']:.4f}[/bold green]")
    table.add_row("Cost Reduction Percentage", f"[bold green]{stats['savings_percent']}%[/bold green]")

    console.print(table)

def main():
    parser = argparse.ArgumentParser(description="ClaudeCut: Cut your Claude API expenses by 40%+")
    subparsers = parser.add_subparsers(dest="command")

    # Start command
    start_parser = subparsers.add_parser("start", help="Start the local ClaudeCut proxy server")
    start_parser.add_argument("--host", default=settings.HOST, help="Host to bind to")
    start_parser.add_argument("--port", type=int, default=settings.PORT, help="Port to bind to")

    # Stats command
    subparsers.add_parser("stats", help="Display cost savings and token analytics")

    args = parser.parse_args()

    if args.command == "stats":
        show_stats()
    elif args.command == "start" or not args.command:
        run_server(getattr(args, "host", settings.HOST), getattr(args, "port", settings.PORT))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
