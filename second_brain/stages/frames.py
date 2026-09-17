from __future__ import annotations

import logging
import shutil
import subprocess
from pathlib import Path

from second_brain.config import Settings
from second_brain.db.store import STATUS_DONE, STATUS_FAILED, Store
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)

FRAME_WIDTH = 768


def _probe_duration(video_path: Path) -> float | None:
    if not shutil.which("ffprobe"):
        return None
    completed = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(video_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    try:
        return float(completed.stdout.strip())
    except ValueError:
        return None


def _extract_frame(video_path: Path, timestamp: float, output: Path) -> bool:
    completed = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-y", "-ss", f"{timestamp:.3f}", "-i", str(video_path),
            "-frames:v", "1", "-vf", f"scale='min({FRAME_WIDTH},iw)':-2", "-q:v", "3",
            str(output),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0 or not output.exists():
        log.debug("ffmpeg failed at %.2fs: %s", timestamp, completed.stderr[-300:])
        return False
    return True


def run(
    store: Store,
    settings: Settings,
    limit: int | None = None,
    retry_failed: bool = False,
) -> StageResult:
    result = StageResult(stage="frames")
    items = store.pending_items("frames", limit=limit, include_failed=retry_failed)
    if not items:
        log.info("nothing to extract frames from")
        return result

    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is not on PATH; install it before running this stage")

    count = settings.frames_per_video
    for item in items:
        result.processed += 1
        item_id = int(item["id"])
        video_path = Path(item["video_path"]) if item["video_path"] else None
        if video_path is None or not video_path.exists():
            store.set_status(item_id, "frames", STATUS_FAILED, "video file missing")
            result.failed += 1
            log.error("video file missing for %s", item["source_id"])
            continue

        duration = item["duration_seconds"] or _probe_duration(video_path)
        if not duration or duration <= 0:
            store.set_status(item_id, "frames", STATUS_FAILED, "unknown video duration")
            result.failed += 1
            log.error("cannot determine duration for %s", item["source_id"])
            continue

        target_dir = settings.frame_dir / item["source_id"]
        target_dir.mkdir(parents=True, exist_ok=True)
        extracted: list[tuple[int, str, float]] = []
        for position in range(count):
            timestamp = duration * (position + 0.5) / count
            output = target_dir / f"frame_{position:02d}.jpg"
            if _extract_frame(video_path, timestamp, output):
                extracted.append((position, str(output), timestamp))

        if not extracted:
            store.set_status(item_id, "frames", STATUS_FAILED, "ffmpeg produced no frames")
            result.failed += 1
            log.error("no frames extracted for %s", item["source_id"])
            continue

        store.save_frames(item_id, extracted)
        store.set_status(item_id, "frames", STATUS_DONE)
        result.succeeded += 1
        log.info("extracted %d frames for %s", len(extracted), item["source_id"])

    log.info(result.summary())
    return result
