from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from second_brain.sources.base import (
    MEDIA_UNKNOWN,
    MEDIA_VIDEO,
    SkippedItem,
    Source,
    SourceItem,
    register,
)

log = logging.getLogger(__name__)

# /reel/, /reels/ and /tv/ are always video. /p/ can be either, so it stays unknown
# until the download stage reads the real media type from the post itself.
_SHORTCODE = re.compile(r"/(p|reel|reels|tv)/([A-Za-z0-9_-]+)")
_VIDEO_PATHS = {"reel", "reels", "tv"}
_EXPORT_FILENAMES = ("saved_posts", "saved_collections", "saved_media")


def repair_mojibake(text: str) -> str:
    """Instagram writes UTF-8 bytes escaped as latin-1, which mangles Hebrew."""
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def find_export_files(export_dir: Path) -> list[Path]:
    if not export_dir.exists():
        raise FileNotFoundError(f"Instagram export directory not found: {export_dir}")
    files = [
        path
        for path in sorted(export_dir.rglob("*.json"))
        if any(name in path.stem for name in _EXPORT_FILENAMES)
    ]
    return files


def _iter_entries(payload: object) -> Iterator[dict]:
    """Yield saved-post entries from any of the export's container shapes."""
    if isinstance(payload, list):
        for entry in payload:
            if isinstance(entry, dict):
                yield entry
    elif isinstance(payload, dict):
        for key, value in payload.items():
            if key.startswith("saved") and isinstance(value, list):
                for entry in value:
                    if isinstance(entry, dict):
                        yield entry


def _entry_links(entry: dict) -> list[dict]:
    """Both export shapes: string_map_data values, or string_list_data entries."""
    links: list[dict] = []
    string_map = entry.get("string_map_data")
    if isinstance(string_map, dict):
        links.extend(value for value in string_map.values() if isinstance(value, dict))
    string_list = entry.get("string_list_data")
    if isinstance(string_list, list):
        links.extend(value for value in string_list if isinstance(value, dict))
    return links


def _timestamp(value: object) -> str | None:
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat(timespec="seconds")


@register
class InstagramSavedPosts(Source):
    """Reads the saved-posts JSON from an official Instagram data export."""

    name = "instagram"

    def __init__(self, export_dir: Path) -> None:
        self.export_dir = export_dir
        self._skipped: list[SkippedItem] = []

    @property
    def skipped(self) -> list[SkippedItem]:
        return self._skipped

    def iter_items(self) -> Iterator[SourceItem]:
        files = find_export_files(self.export_dir)
        if not files:
            raise FileNotFoundError(
                f"no saved-posts JSON found under {self.export_dir}. Expected a file whose"
                f" name contains one of: {', '.join(_EXPORT_FILENAMES)}"
            )
        log.info("reading %d export file(s) from %s", len(files), self.export_dir)

        seen: set[str] = set()
        for path in files:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as error:
                log.error("cannot read %s: %s", path, error)
                self._skipped.append(SkippedItem("unreadable_file", str(path)))
                continue

            for entry in _iter_entries(payload):
                item = self._entry_to_item(entry, path)
                if item is None:
                    continue
                if item.source_id in seen:
                    continue
                seen.add(item.source_id)
                yield item

    def _entry_to_item(self, entry: dict, path: Path) -> SourceItem | None:
        links = _entry_links(entry)
        href = next(
            (link.get("href") for link in links if isinstance(link.get("href"), str)), None
        )
        if not href:
            self._skipped.append(SkippedItem("no_url", json.dumps(entry)[:200]))
            return None

        match = _SHORTCODE.search(href)
        if not match:
            log.info("skipping non-post URL: %s", href)
            self._skipped.append(SkippedItem("not_a_post", href))
            return None

        path_kind, shortcode = match.group(1), match.group(2)
        saved_at = next(
            (_timestamp(link.get("timestamp")) for link in links if link.get("timestamp")),
            None,
        )
        author = entry.get("title") or next(
            (link.get("value") for link in links if isinstance(link.get("value"), str)),
            None,
        )
        return SourceItem(
            source=self.name,
            source_id=shortcode,
            url=f"https://www.instagram.com/{path_kind}/{shortcode}/",
            author=repair_mojibake(author) if author else None,
            caption=None,  # the export carries no caption; yt-dlp supplies it on download
            saved_at=saved_at,
            media_type=MEDIA_VIDEO if path_kind in _VIDEO_PATHS else MEDIA_UNKNOWN,
            raw={"href": href, "export_file": path.name, "entry": entry},
        )
