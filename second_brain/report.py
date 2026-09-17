from __future__ import annotations

from second_brain.config import Settings
from second_brain.db.store import STAGE_PREREQUISITES, Store
from second_brain.stages.base import StageResult

_STATUS_ORDER = ["done", "pending", "failed", "skipped"]


def render(
    store: Store, settings: Settings, results: list[StageResult] | None = None
) -> str:
    lines: list[str] = ["", "=" * 66, "SECOND BRAIN - RUN REPORT", "=" * 66]

    if results:
        lines.append("")
        lines.append("This run:")
        for result in results:
            lines.append(f"  {result.summary()}")
            for note in result.notes:
                lines.append(f"    ! {note}")

    counts = store.stage_counts()
    lines += ["", f"Database: {store.item_total()} items in {settings.db_path}", ""]
    header = f"  {'stage':<12}" + "".join(f"{status:>10}" for status in _STATUS_ORDER)
    lines.append(header)
    lines.append("  " + "-" * (len(header) - 2))
    for stage in STAGE_PREREQUISITES:
        row = counts.get(stage, {})
        cells = "".join(f"{row.get(status, 0):>10}" for status in _STATUS_ORDER)
        lines.append(f"  {stage:<12}{cells}")

    failures = store.failures()
    if failures:
        lines += ["", f"Failures ({len(failures)} shown):"]
        for item in failures:
            for stage in STAGE_PREREQUISITES:
                if item[f"{stage}_status"] == "failed":
                    error = (item[f"{stage}_error"] or "").splitlines()[:1]
                    detail = error[0] if error else "no detail"
                    lines.append(f"  {item['source_id']} [{stage}] {detail[:90]}")

    usage = store.usage_totals()
    if usage:
        total_cost = sum(row["cost_usd"] for row in usage)
        lines += ["", "Claude API usage:"]
        for row in usage:
            lines.append(
                f"  {row['stage']:<12} {row['model']:<18} {row['calls']:>4} calls"
                f"  in {row['input_tokens']:>8}  out {row['output_tokens']:>7}"
                f"  ${row['cost_usd']:.4f}"
            )
        lines.append(f"  {'TOTAL':<12} {'':<18} {'':>4}       {'':>8}       {'':>7}"
                     f"  ${total_cost:.4f}")
        lines.append("  (estimate from published per-token prices, not a billed amount)")

    lines.append("=" * 66)
    return "\n".join(lines)
