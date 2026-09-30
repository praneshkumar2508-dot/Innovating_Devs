"""
Example: Asynchronous Parallel API Aggregator.
Demonstrates concurrent async execution, MapReduce operator, and telemetry.
"""

import asyncio
from typing import Any, Dict, List
from graphengine import GraphEngine
from graphengine.operators.map_reduce import MapReduceNode


def build_async_aggregator() -> GraphEngine:
    engine = GraphEngine(
        graph_id="crypto_market_aggregator",
        name="Crypto Market Ticker Aggregator",
        description="Concurrently fetches simulated live ticker rates and computes aggregate statistics.",
    )

    # 1. Source Symbols Generator
    def get_tracked_symbols() -> Dict[str, Any]:
        return {
            "items": ["BTC", "ETH", "SOL", "AVAX", "DOT", "LINK", "ADA", "MATIC"]
        }

    # 2. Worker task (simulated async API call per coin)
    async def fetch_ticker(symbol: str) -> Dict[str, Any]:
        # Simulate network latency
        await asyncio.sleep(0.04)
        mock_prices = {
            "BTC": 64200.0,
            "ETH": 3450.0,
            "SOL": 145.0,
            "AVAX": 28.5,
            "DOT": 6.8,
            "LINK": 14.2,
            "ADA": 0.45,
            "MATIC": 0.52,
        }
        mock_volumes = {
            "BTC": 28000000000,
            "ETH": 14000000000,
            "SOL": 3500000000,
            "AVAX": 450000000,
            "DOT": 180000000,
            "LINK": 320000000,
            "ADA": 290000000,
            "MATIC": 210000000,
        }
        price = mock_prices.get(symbol, 10.0)
        volume = mock_volumes.get(symbol, 100000000)
        return {"symbol": symbol, "price": price, "volume_24h": volume}

    # 3. Reducer task: Calculate summary metrics
    def summarize_market(results: List[Dict[str, Any]]) -> Dict[str, Any]:
        total_market_cap = sum(r["price"] * (r["volume_24h"] / 100000) for r in results)
        highest_volume = max(results, key=lambda x: x["volume_24h"])
        return {
            "tracked_count": len(results),
            "top_volume_asset": highest_volume["symbol"],
            "total_estimated_volume": sum(r["volume_24h"] for r in results),
            "tickers": {r["symbol"]: r["price"] for r in results},
        }

    # Register nodes
    engine.add_node("symbols", get_tracked_symbols, name="Tracked Symbols Source")

    map_reduce_node = MapReduceNode(
        node_id="fetch_all_tickers",
        map_fn=fetch_ticker,
        reduce_fn=summarize_market,
        items_key="items",
        concurrency_limit=5,
        name="Concurrent Ticker Fetcher & Summarizer",
    )
    engine.add_node(map_reduce_node)

    # Final reporting node
    def format_market_report(reduced: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "summary_headline": f"Analyzed {reduced['tracked_count']} assets. Top volume: {reduced['top_volume_asset']}",
            "market_summary": reduced,
        }

    engine.add_node("report", format_market_report, name="Generate Executive Report")

    # Wire up edges
    engine.add_edge("symbols", "fetch_all_tickers")
    engine.add_edge("fetch_all_tickers", "report")

    return engine


if __name__ == "__main__":
    aggregator = build_async_aggregator()
    ctx = aggregator.run()
    print("Status:", ctx.status, f"in {ctx.total_duration_ms}ms")
    print("Execution Order:", ctx.execution_order)
    print("Report Output:", ctx.get_output("report"))
