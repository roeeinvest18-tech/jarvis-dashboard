from __future__ import annotations

import json
import logging
import sqlite3

log = logging.getLogger(__name__)

MAX_TRANSCRIPT_CHARS = 2000


class Embedder:
    """Local multilingual sentence embeddings, so Hebrew and English share one space."""

    def __init__(self, model_name: str) -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as error:
            raise RuntimeError(
                "sentence-transformers is not installed; run pip install -r requirements.txt"
            ) from error
        log.info("loading embedding model %s", model_name)
        self._model = SentenceTransformer(model_name)
        self.dimensions = self._model.get_sentence_embedding_dimension()

    def _encode(self, text: str) -> list[float]:
        vector = self._model.encode(text, normalize_embeddings=True)
        return [float(value) for value in vector]

    def embed_passage(self, text: str) -> list[float]:
        return self._encode(f"passage: {text}")

    def embed_query(self, text: str) -> list[float]:
        return self._encode(f"query: {text}")


def build_document(
    item: sqlite3.Row, analysis: sqlite3.Row, transcript: sqlite3.Row | None
) -> str:
    parts = [
        analysis["title"],
        analysis["category"],
        " ".join(json.loads(analysis["tags"])),
        analysis["summary"],
        " ".join(json.loads(analysis["key_points"])),
    ]
    if item["caption"]:
        parts.append(item["caption"])
    if transcript and transcript["text"]:
        parts.append(transcript["text"][:MAX_TRANSCRIPT_CHARS])
    return "\n".join(part for part in parts if part)
