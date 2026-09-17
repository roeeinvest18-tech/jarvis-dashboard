from __future__ import annotations

import json
import logging
from datetime import date

from second_brain.analysis.categories import Taxonomy, load_taxonomy, write_taxonomy
from second_brain.analysis.claude_client import AnalysisError, ClaudeClient
from second_brain.analysis.prompts import (
    RECLASSIFY_SYSTEM,
    TAXONOMY_SYSTEM,
    build_reclassify_prompt,
    build_taxonomy_prompt,
    reclassify_schema,
    taxonomy_schema,
)
from second_brain.config import Settings
from second_brain.db.store import STATUS_PENDING, Store
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)

_HEADER = """\
# Category taxonomy for the second brain.
# Edit freely: rename, merge, delete or add categories, then run
#   python -m second_brain reclassify
# to re-file every analysed video against this list.
"""


def propose(store: Store, settings: Settings, limit: int | None = None) -> StageResult:
    result = StageResult(stage="taxonomy")
    rows = store.analyses_with_items(limit=limit)
    if not rows:
        log.error("no analysed videos yet; run the analyze stage first")
        return result

    payload = [
        {
            "title": row["title"],
            "category": row["category"],
            "tags": json.loads(row["tags"]),
        }
        for row in rows
    ]
    client = ClaudeClient(settings)
    log.info("proposing a taxonomy from %d analysed videos", len(payload))

    try:
        completion = client.complete(
            TAXONOMY_SYSTEM,
            build_taxonomy_prompt(payload),
            schema=taxonomy_schema(),
            effort="high",
        )
        categories = completion.json()["categories"]
    except AnalysisError as error:
        log.error("taxonomy proposal failed: %s", error)
        result.failed += 1
        return result

    store.record_usage(
        "taxonomy",
        client.model,
        completion.input_tokens,
        completion.output_tokens,
        completion.cost_usd,
    )
    proposal = Taxonomy(version=date.today().isoformat(), categories=categories)
    write_taxonomy(settings.proposed_categories_file, proposal, _HEADER)

    result.processed = len(payload)
    result.succeeded = len(categories)
    log.info(
        "proposed %d categories in %s", len(categories), settings.proposed_categories_file
    )
    for category in categories:
        log.info("  %s: %s", category["name"], category["description"])
    log.info(
        "review that file, then run: python -m second_brain taxonomy approve"
    )
    return result


def approve(settings: Settings) -> StageResult:
    result = StageResult(stage="taxonomy")
    proposal = load_taxonomy(settings.proposed_categories_file)
    if proposal is None:
        log.error(
            "no proposal found at %s; run taxonomy propose first",
            settings.proposed_categories_file,
        )
        result.failed += 1
        return result

    proposal.version = date.today().isoformat()
    write_taxonomy(settings.categories_file, proposal, _HEADER)
    result.succeeded = len(proposal.categories)
    log.info(
        "approved %d categories into %s; run reclassify to re-file existing videos",
        len(proposal.categories),
        settings.categories_file,
    )
    return result


def reclassify(
    store: Store, settings: Settings, limit: int | None = None, force: bool = False
) -> StageResult:
    result = StageResult(stage="reclassify")
    taxonomy = load_taxonomy(settings.categories_file)
    if taxonomy is None:
        log.error("no approved taxonomy at %s", settings.categories_file)
        result.failed += 1
        return result

    rows = [
        row
        for row in store.analyses_with_items()
        if force or row["taxonomy_version"] != taxonomy.version
    ]
    if limit is not None:
        rows = rows[:limit]
    if not rows:
        log.info("every analysed video already uses the current taxonomy")
        return result

    client = ClaudeClient(settings)
    schema = reclassify_schema(taxonomy)

    for row in rows:
        result.processed += 1
        analysis = {
            "title": row["title"],
            "summary": row["summary"],
            "key_points": json.loads(row["key_points"]),
            "tags": json.loads(row["tags"]),
            "category": row["category"],
        }
        try:
            completion = client.complete(
                RECLASSIFY_SYSTEM,
                build_reclassify_prompt(analysis, taxonomy),
                schema=schema,
                max_tokens=1000,
                effort="low",
            )
            category = completion.json()["category"]
        except AnalysisError as error:
            result.failed += 1
            log.error("reclassify failed for item %s: %s", row["item_id"], error)
            continue

        store.update_category(int(row["item_id"]), category, taxonomy.version)
        # The category is part of the embedded text, so the vector is now stale.
        store.set_status(int(row["item_id"]), "embed", STATUS_PENDING)
        store.record_usage(
            "reclassify",
            client.model,
            completion.input_tokens,
            completion.output_tokens,
            completion.cost_usd,
            int(row["item_id"]),
        )
        result.succeeded += 1
        log.info("%s -> %s", row["title"], category)

    log.info(result.summary())
    return result
