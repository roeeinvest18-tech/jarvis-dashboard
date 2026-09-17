from __future__ import annotations

import logging
from pathlib import Path

from second_brain.config import Settings
from second_brain.db.store import STATUS_DONE, STATUS_FAILED, Store
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)


def _load_model(settings: Settings):
    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError(
            "faster-whisper is not installed; run pip install -r requirements.txt"
        ) from error

    log.info(
        "loading faster-whisper %s on %s (%s)",
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    return WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )


def run(
    store: Store,
    settings: Settings,
    limit: int | None = None,
    retry_failed: bool = False,
) -> StageResult:
    result = StageResult(stage="transcribe")
    items = store.pending_items("transcribe", limit=limit, include_failed=retry_failed)
    if not items:
        log.info("nothing to transcribe")
        return result

    model = _load_model(settings)

    for item in items:
        result.processed += 1
        item_id = int(item["id"])
        video_path = Path(item["video_path"]) if item["video_path"] else None
        if video_path is None or not video_path.exists():
            store.set_status(item_id, "transcribe", STATUS_FAILED, "video file missing")
            result.failed += 1
            log.error("video file missing for %s", item["source_id"])
            continue

        log.info("transcribing %s", video_path.name)
        try:
            segments, info = model.transcribe(str(video_path), vad_filter=True)
            collected = [
                {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
                for segment in segments
            ]
        except Exception as error:  # noqa: BLE001 - third-party decoder errors vary
            store.set_status(item_id, "transcribe", STATUS_FAILED, str(error)[:500])
            result.failed += 1
            log.error("transcription failed for %s: %s", item["source_id"], error)
            continue

        text = " ".join(segment["text"] for segment in collected).strip()
        store.save_transcript(
            item_id,
            text,
            info.language,
            info.language_probability,
            settings.whisper_model,
            collected,
        )
        store.set_status(item_id, "transcribe", STATUS_DONE)
        result.succeeded += 1
        log.info(
            "transcribed %s: %s, %d characters",
            item["source_id"],
            info.language,
            len(text),
        )

    log.info(result.summary())
    return result
