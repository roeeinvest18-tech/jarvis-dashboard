from __future__ import annotations

import logging

from second_brain.analysis.embedding import Embedder, build_document
from second_brain.config import Settings
from second_brain.db.store import STATUS_DONE, STATUS_FAILED, Store
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)


def run(
    store: Store,
    settings: Settings,
    limit: int | None = None,
    retry_failed: bool = False,
) -> StageResult:
    result = StageResult(stage="embed")
    items = store.pending_items("embed", limit=limit, include_failed=retry_failed)
    if not items:
        log.info("nothing to embed")
        return result

    embedder = Embedder(settings.embedding_model)
    vectors_enabled = store.ensure_vector_table(embedder.dimensions)
    if not vectors_enabled:
        result.notes.append("sqlite-vec unavailable; stored full-text index only")

    for item in items:
        result.processed += 1
        item_id = int(item["id"])
        analysis = store.get_analysis(item_id)
        if analysis is None:
            store.set_status(item_id, "embed", STATUS_FAILED, "no analysis row")
            result.failed += 1
            continue

        document = build_document(item, analysis, store.get_transcript(item_id))
        store.save_fts(item_id, document)
        if vectors_enabled:
            store.save_embedding(item_id, embedder.embed_passage(document))
        store.set_status(item_id, "embed", STATUS_DONE)
        result.succeeded += 1
        log.debug("embedded %s", item["source_id"])

    log.info(result.summary())
    return result
