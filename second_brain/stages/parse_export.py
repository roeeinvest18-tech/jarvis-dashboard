from __future__ import annotations

import logging
from itertools import islice

from second_brain.config import Settings
from second_brain.db.store import Store
from second_brain.sources import build_source
from second_brain.sources.base import MEDIA_IMAGE
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)


def run(
    store: Store,
    settings: Settings,
    limit: int | None = None,
    source_name: str = "instagram",
) -> StageResult:
    result = StageResult(stage="parse_export")
    source = build_source(source_name, settings.export_dir)

    items = source.iter_items()
    if limit is not None:
        items = islice(items, limit)

    for item in items:
        result.processed += 1
        if item.media_type == MEDIA_IMAGE:
            result.skipped += 1
            log.info("skipping non-video item %s (%s)", item.source_id, item.url)
            continue
        _, created = store.upsert_item(item)
        result.succeeded += 1
        if created:
            log.debug("new item %s (%s)", item.source_id, item.url)

    for skipped in source.skipped:
        result.skipped += 1
        log.info("skipped by source [%s]: %s", skipped.reason, skipped.detail)

    log.info(
        "%s; %d items in the database", result.summary(), store.item_total()
    )
    return result
