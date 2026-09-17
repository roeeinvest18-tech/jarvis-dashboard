from __future__ import annotations

import logging
import random
import time
from pathlib import Path

from second_brain.config import Settings
from second_brain.db.store import STATUS_DONE, STATUS_FAILED, STATUS_SKIPPED, Store
from second_brain.sources.base import MEDIA_IMAGE, MEDIA_VIDEO
from second_brain.stages.base import StageResult

log = logging.getLogger(__name__)

VIDEO_SUFFIXES = {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
CONSECUTIVE_FAILURE_LIMIT = 3


def _ydl_options(settings: Settings) -> dict:
    return {
        "outtmpl": str(settings.video_dir / "%(id)s.%(ext)s"),
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "cookiesfrombrowser": (settings.cookies_browser,),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "continuedl": True,
        "retries": 3,
        "ignoreerrors": False,
    }


def _downloaded_files(info: dict) -> list[tuple[Path, dict]]:
    entries = info.get("entries") or [info]
    files: list[tuple[Path, dict]] = []
    for entry in entries:
        if not entry:
            continue
        for download in entry.get("requested_downloads") or []:
            filepath = download.get("filepath")
            if filepath:
                files.append((Path(filepath), entry))
    return files


def run(
    store: Store,
    settings: Settings,
    limit: int | None = None,
    retry_failed: bool = False,
) -> StageResult:
    result = StageResult(stage="download")
    items = store.pending_items("download", limit=limit, include_failed=retry_failed)
    if not items:
        log.info("nothing to download")
        return result

    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError as error:
        raise RuntimeError("yt-dlp is not installed; run pip install -r requirements.txt") from error

    settings.video_dir.mkdir(parents=True, exist_ok=True)
    consecutive_failures = 0

    with YoutubeDL(_ydl_options(settings)) as ydl:
        for index, item in enumerate(items):
            if index:
                delay = random.uniform(settings.download_min_delay, settings.download_max_delay)
                log.info("waiting %.1fs before the next download", delay)
                time.sleep(delay)

            result.processed += 1
            item_id = int(item["id"])
            log.info("downloading %s (%s)", item["source_id"], item["url"])
            try:
                info = ydl.extract_info(item["url"], download=True)
            except DownloadError as error:
                message = str(error).strip()
                store.set_status(item_id, "download", STATUS_FAILED, message[:500])
                result.failed += 1
                consecutive_failures += 1
                log.error("download failed for %s: %s", item["source_id"], message)
                if consecutive_failures >= CONSECUTIVE_FAILURE_LIMIT:
                    note = (
                        f"aborting after {consecutive_failures} consecutive failures;"
                        " check that the browser cookies are still valid"
                    )
                    log.error(note)
                    result.notes.append(note)
                    break
                continue

            consecutive_failures = 0
            files = _downloaded_files(info or {})
            video = next(
                ((path, entry) for path, entry in files if path.suffix.lower() in VIDEO_SUFFIXES),
                None,
            )

            if video is None:
                for path, _ in files:
                    path.unlink(missing_ok=True)
                store.set_media_details(
                    item_id, None, None, None, None, media_type=MEDIA_IMAGE
                )
                store.set_status(item_id, "download", STATUS_SKIPPED, "not a video post")
                result.skipped += 1
                log.info("skipping non-video post %s", item["source_id"])
                continue

            # A carousel can hold several clips; keep the first and drop the rest.
            video_path, entry = video
            for path, _ in files:
                if path != video_path and path.suffix.lower() not in VIDEO_SUFFIXES:
                    path.unlink(missing_ok=True)

            store.set_media_details(
                item_id,
                str(video_path),
                entry.get("duration"),
                entry.get("description"),
                entry.get("uploader") or entry.get("channel"),
                media_type=MEDIA_VIDEO,
            )
            store.set_status(item_id, "download", STATUS_DONE)
            result.succeeded += 1
            log.info("saved %s (%.0fs)", video_path.name, entry.get("duration") or 0)

    log.info(result.summary())
    return result
