from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Sequence

from second_brain.sources.base import SourceItem

log = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).with_name("schema.sql")

STATUS_PENDING = "pending"
STATUS_DONE = "done"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"

# Per stage: the status column prefix and the condition earlier stages must satisfy.
STAGE_PREREQUISITES: dict[str, str] = {
    "download": "media_type != 'image'",
    "transcribe": "download_status = 'done'",
    "frames": "download_status = 'done'",
    "analyze": (
        "download_status = 'done'"
        " AND transcribe_status IN ('done', 'failed', 'skipped')"
        " AND frames_status IN ('done', 'failed', 'skipped')"
    ),
    "embed": "analyze_status = 'done'",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def open_store(db_path: Path) -> Store:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    return Store(connection)


class Store:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection
        self._vec_loaded: bool | None = None

    def close(self) -> None:
        self.connection.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self.connection:
            yield self.connection

    # ------------------------------------------------------------------ items

    def upsert_item(self, item: SourceItem) -> tuple[int, bool]:
        """Insert the item if new. Returns (item_id, created)."""
        existing = self.connection.execute(
            "SELECT id FROM items WHERE source = ? AND source_id = ?",
            (item.source, item.source_id),
        ).fetchone()
        if existing:
            with self.transaction() as conn:
                conn.execute(
                    """
                    UPDATE items
                       SET url = ?, author = COALESCE(?, author),
                           caption = COALESCE(?, caption), saved_at = COALESCE(?, saved_at),
                           media_type = ?, raw_metadata = ?
                     WHERE id = ?
                    """,
                    (
                        item.url,
                        item.author,
                        item.caption,
                        item.saved_at,
                        item.media_type,
                        json.dumps(item.raw, ensure_ascii=False),
                        existing["id"],
                    ),
                )
            return int(existing["id"]), False

        with self.transaction() as conn:
            cursor = conn.execute(
                """
                INSERT INTO items (source, source_id, url, author, caption, saved_at,
                                   media_type, raw_metadata, discovered_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item.source,
                    item.source_id,
                    item.url,
                    item.author,
                    item.caption,
                    item.saved_at,
                    item.media_type,
                    json.dumps(item.raw, ensure_ascii=False),
                    _now(),
                ),
            )
        return int(cursor.lastrowid), True

    def set_status(
        self, item_id: int, stage: str, status: str, error: str | None = None
    ) -> None:
        if stage not in STAGE_PREREQUISITES:
            raise ValueError(f"unknown stage: {stage}")
        with self.transaction() as conn:
            conn.execute(
                f"UPDATE items SET {stage}_status = ?, {stage}_error = ?, {stage}_at = ?"
                " WHERE id = ?",
                (status, error, _now(), item_id),
            )

    def pending_items(
        self, stage: str, limit: int | None = None, include_failed: bool = False
    ) -> list[sqlite3.Row]:
        if stage not in STAGE_PREREQUISITES:
            raise ValueError(f"unknown stage: {stage}")
        statuses = [STATUS_PENDING] + ([STATUS_FAILED] if include_failed else [])
        placeholders = ", ".join("?" for _ in statuses)
        sql = (
            f"SELECT * FROM items WHERE {stage}_status IN ({placeholders})"
            f" AND {STAGE_PREREQUISITES[stage]} ORDER BY id"
        )
        params: list[object] = list(statuses)
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        return self.connection.execute(sql, params).fetchall()

    def get_item(self, item_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM items WHERE id = ?", (item_id,)
        ).fetchone()

    def set_media_details(
        self,
        item_id: int,
        video_path: str | None,
        duration_seconds: float | None,
        caption: str | None,
        author: str | None,
        media_type: str | None = None,
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                UPDATE items
                   SET video_path = COALESCE(?, video_path),
                       duration_seconds = COALESCE(?, duration_seconds),
                       caption = COALESCE(NULLIF(?, ''), caption),
                       author = COALESCE(NULLIF(?, ''), author),
                       media_type = COALESCE(?, media_type),
                       video_deleted = 0
                 WHERE id = ?
                """,
                (video_path, duration_seconds, caption, author, media_type, item_id),
            )

    def mark_video_deleted(self, item_id: int) -> None:
        with self.transaction() as conn:
            conn.execute(
                "UPDATE items SET video_deleted = 1, video_path = NULL WHERE id = ?",
                (item_id,),
            )

    # ------------------------------------------------------------ stage output

    def save_transcript(
        self,
        item_id: int,
        text: str,
        language: str | None,
        language_probability: float | None,
        model: str,
        segments: list[dict],
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO transcripts (item_id, text, language, language_probability,
                                         model, segments, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (item_id) DO UPDATE SET
                    text = excluded.text, language = excluded.language,
                    language_probability = excluded.language_probability,
                    model = excluded.model, segments = excluded.segments,
                    created_at = excluded.created_at
                """,
                (
                    item_id,
                    text,
                    language,
                    language_probability,
                    model,
                    json.dumps(segments, ensure_ascii=False),
                    _now(),
                ),
            )

    def get_transcript(self, item_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM transcripts WHERE item_id = ?", (item_id,)
        ).fetchone()

    def save_frames(self, item_id: int, frames: Sequence[tuple[int, str, float]]) -> None:
        with self.transaction() as conn:
            conn.execute("DELETE FROM frames WHERE item_id = ?", (item_id,))
            conn.executemany(
                "INSERT INTO frames (item_id, position, path, timestamp_seconds)"
                " VALUES (?, ?, ?, ?)",
                [(item_id, position, path, ts) for position, path, ts in frames],
            )

    def get_frames(self, item_id: int) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM frames WHERE item_id = ? ORDER BY position", (item_id,)
        ).fetchall()

    def save_analysis(
        self,
        item_id: int,
        analysis: dict,
        model: str,
        taxonomy_version: str | None,
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO analyses (item_id, title, summary, key_points, category, tags,
                                      language, actionable, model, taxonomy_version,
                                      created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (item_id) DO UPDATE SET
                    title = excluded.title, summary = excluded.summary,
                    key_points = excluded.key_points, category = excluded.category,
                    tags = excluded.tags, language = excluded.language,
                    actionable = excluded.actionable, model = excluded.model,
                    taxonomy_version = excluded.taxonomy_version,
                    updated_at = excluded.updated_at
                """,
                (
                    item_id,
                    analysis["title"],
                    analysis["summary"],
                    json.dumps(analysis["key_points"], ensure_ascii=False),
                    analysis["category"],
                    json.dumps(analysis["tags"], ensure_ascii=False),
                    analysis.get("language"),
                    int(bool(analysis.get("actionable"))),
                    model,
                    taxonomy_version,
                    _now(),
                    _now(),
                ),
            )

    def update_category(
        self, item_id: int, category: str, taxonomy_version: str | None
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                "UPDATE analyses SET category = ?, taxonomy_version = ?, updated_at = ?"
                " WHERE item_id = ?",
                (category, taxonomy_version, _now(), item_id),
            )

    def get_analysis(self, item_id: int) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT * FROM analyses WHERE item_id = ?", (item_id,)
        ).fetchone()

    def analyses_with_items(self, limit: int | None = None) -> list[sqlite3.Row]:
        sql = (
            "SELECT a.*, i.url, i.author, i.caption FROM analyses a"
            " JOIN items i ON i.id = a.item_id ORDER BY a.item_id"
        )
        params: list[object] = []
        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)
        return self.connection.execute(sql, params).fetchall()

    def record_usage(
        self,
        stage: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
        item_id: int | None = None,
    ) -> None:
        with self.transaction() as conn:
            conn.execute(
                """
                INSERT INTO api_usage (stage, item_id, model, input_tokens, output_tokens,
                                       cost_usd, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (stage, item_id, model, input_tokens, output_tokens, cost_usd, _now()),
            )

    # ----------------------------------------------------------------- search

    def _load_vec(self) -> bool:
        if self._vec_loaded is not None:
            return self._vec_loaded
        try:
            import sqlite_vec

            self.connection.enable_load_extension(True)
            sqlite_vec.load(self.connection)
            self.connection.enable_load_extension(False)
            self._vec_loaded = True
        except Exception as error:  # noqa: BLE001 - optional native dependency
            log.warning(
                "sqlite-vec unavailable (%s); semantic search falls back to full-text",
                error,
            )
            self._vec_loaded = False
        return self._vec_loaded

    def ensure_vector_table(self, dimensions: int) -> bool:
        if not self._load_vec():
            return False
        self.connection.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS vec_items USING vec0("
            f"item_id INTEGER PRIMARY KEY, embedding float[{dimensions}])"
        )
        return True

    def save_embedding(self, item_id: int, vector: Sequence[float]) -> None:
        import sqlite_vec

        blob = sqlite_vec.serialize_float32(list(vector))
        with self.transaction() as conn:
            conn.execute("DELETE FROM vec_items WHERE item_id = ?", (item_id,))
            conn.execute(
                "INSERT INTO vec_items (item_id, embedding) VALUES (?, ?)",
                (item_id, blob),
            )

    def save_fts(self, item_id: int, content: str) -> None:
        with self.transaction() as conn:
            conn.execute("DELETE FROM items_fts WHERE item_id = ?", (item_id,))
            conn.execute(
                "INSERT INTO items_fts (item_id, content) VALUES (?, ?)",
                (item_id, content),
            )

    def search_vector(self, vector: Sequence[float], k: int) -> list[tuple[int, float]]:
        if not self.ensure_vector_table(len(vector)):
            return []
        import sqlite_vec

        rows = self.connection.execute(
            "SELECT item_id, distance FROM vec_items"
            " WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (sqlite_vec.serialize_float32(list(vector)), k),
        ).fetchall()
        return [(int(row["item_id"]), float(row["distance"])) for row in rows]

    def search_fts(self, query: str, k: int) -> list[tuple[int, float]]:
        escaped = '"' + query.replace('"', " ") + '"'
        try:
            rows = self.connection.execute(
                "SELECT item_id, rank FROM items_fts WHERE items_fts MATCH ?"
                " ORDER BY rank LIMIT ?",
                (escaped, k),
            ).fetchall()
        except sqlite3.OperationalError as error:
            log.debug("full-text query failed (%s)", error)
            return []
        return [(int(row["item_id"]), float(row["rank"])) for row in rows]

    # ----------------------------------------------------------------- report

    def stage_counts(self) -> dict[str, dict[str, int]]:
        counts: dict[str, dict[str, int]] = {}
        for stage in STAGE_PREREQUISITES:
            rows = self.connection.execute(
                f"SELECT {stage}_status AS status, COUNT(*) AS total FROM items"
                f" GROUP BY {stage}_status"
            ).fetchall()
            counts[stage] = {row["status"]: int(row["total"]) for row in rows}
        return counts

    def failures(self, limit: int = 20) -> list[sqlite3.Row]:
        clauses = " OR ".join(f"{stage}_status = 'failed'" for stage in STAGE_PREREQUISITES)
        return self.connection.execute(
            f"SELECT * FROM items WHERE {clauses} ORDER BY id LIMIT ?", (limit,)
        ).fetchall()

    def usage_totals(self) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT stage, model, SUM(input_tokens) AS input_tokens,"
            " SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd,"
            " COUNT(*) AS calls FROM api_usage GROUP BY stage, model"
        ).fetchall()

    def item_total(self) -> int:
        row = self.connection.execute("SELECT COUNT(*) AS total FROM items").fetchone()
        return int(row["total"])
