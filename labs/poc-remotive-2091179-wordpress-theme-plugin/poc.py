#!/usr/bin/env python3
"""Runnable KPI Aggregation & Health Summary PoC."""
import json
import sys
from pathlib import Path


def summarize_records(payload: dict) -> dict:
    rows = payload.get("records", [])
    total_mrr = sum(int(r.get("mrr_usd") or 0) for r in rows)
    active = [r for r in rows if r.get("status") == "Active"]
    avg_lat = round(sum(int(r.get("latency_ms") or 0) for r in rows) / max(1, len(rows)), 1)
    return {
        "total_accounts": len(rows),
        "active_accounts": len(active),
        "total_mrr_usd": total_mrr,
        "avg_latency_ms": avg_lat,
        "at_risk_segments": [r.get("segment") for r in rows if r.get("status") != "Active"],
    }


def main() -> int:
    sample_path = Path(__file__).with_name("sample_input.json")
    data = json.loads(sample_path.read_text(encoding="utf-8")) if sample_path.exists() else {"records": []}
    result = summarize_records(data)
    if "--self-test" in sys.argv:
        assert result["total_mrr_usd"] > 0
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
