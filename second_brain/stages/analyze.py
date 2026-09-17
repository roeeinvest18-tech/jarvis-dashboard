from __future__ import annotations

import json
import logging
from pathlib import Path

from second_brain.analysis.categories import load_taxonomy
from second_brain.analysis.claude_client import AnalysisError, ClaudeClient
from second_brain.analysis.prompts import (
    ANALYSIS_SYSTEM,
    analysis_schema,
    build_analysis_content,
)
from second_brain.config import Settings
from second_brain.db.store import STATUS_DONE, STATUS_FAILED, Store
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)


def run(
    store: Store,
    settings: Settings,
    limit: int | None = None,
    retry_failed: bool = False,
    delete_videos: bool = False,
) -> StageResult:
    result = StageResult(stage="analyze")
    items = store.pending_items("analyze", limit=limit, include_failed=retry_failed)
    if not items:
        log.info("nothing to analyze")
        return result

    client = ClaudeClient(settings)
    taxonomy = load_taxonomy(settings.categories_file)
    schema = analysis_schema(taxonomy)
    if taxonomy:
        log.info("classifying against %d approved categories", len(taxonomy.categories))
    else:
        log.info("no approved taxonomy yet; categories stay free-form for this pass")

    for item in items:
        result.processed += 1
        item_id = int(item["id"])
        transcript = store.get_transcript(item_id)
        frame_paths = [Path(row["path"]) for row in store.get_frames(item_id)]

        content = build_analysis_content(
            url=item["url"],
            author=item["author"],
            caption=item["caption"],
            transcript=transcript["text"] if transcript else None,
            transcript_language=transcript["language"] if transcript else None,
            frame_paths=frame_paths,
            taxonomy=taxonomy,
        )

        log.info("analyzing %s (%d frames)", item["source_id"], len(frame_paths))
        try:
            completion = client.complete(ANALYSIS_SYSTEM, content, schema=schema)
            analysis = completion.json()
        except AnalysisError as error:
            store.set_status(item_id, "analyze", STATUS_FAILED, str(error)[:500])
            result.failed += 1
            log.error("analysis failed for %s: %s", item["source_id"], error)
            continue
        except json.JSONDecodeError as error:
            store.set_status(item_id, "analyze", STATUS_FAILED, f"invalid JSON: {error}")
            result.failed += 1
            log.error("model returned invalid JSON for %s", item["source_id"])
            continue

        store.save_analysis(
            item_id,
            analysis,
            client.model,
            taxonomy.version if taxonomy else None,
        )
        store.record_usage(
            "analyze",
            client.model,
            completion.input_tokens,
            completion.output_tokens,
            completion.cost_usd,
            item_id,
        )
        store.set_status(item_id, "analyze", STATUS_DONE)
        result.succeeded += 1
        log.info(
            "analyzed %s: %s [%s] ($%.4f)",
            item["source_id"],
            analysis["title"],
            analysis["category"],
            completion.cost_usd,
        )

        if delete_videos and item["video_path"]:
            Path(item["video_path"]).unlink(missing_ok=True)
            store.mark_video_deleted(item_id)
            log.debug("deleted video file for %s", item["source_id"])

    log.info(result.summary())
    return result
