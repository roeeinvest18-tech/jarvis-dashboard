from __future__ import annotations

import json
import logging

from second_brain.analysis.claude_client import AnalysisError, ClaudeClient
from second_brain.analysis.embedding import Embedder
from second_brain.analysis.prompts import SEARCH_SYSTEM, build_search_prompt
from second_brain.config import Settings
from second_brain.db.store import Store

log = logging.getLogger(__name__)

RRF_CONSTANT = 60


def _fuse(*rankings: list[tuple[int, float]]) -> list[int]:
    """Reciprocal rank fusion, so vector hits and keyword hits share one ordering."""
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, (item_id, _) in enumerate(ranking):
            scores[item_id] = scores.get(item_id, 0.0) + 1.0 / (RRF_CONSTANT + rank + 1)
    return [item_id for item_id, _ in sorted(scores.items(), key=lambda pair: -pair[1])]


def retrieve(store: Store, settings: Settings, question: str, k: int) -> list[dict]:
    keyword_hits = store.search_fts(question, k * 2)

    vector_hits: list[tuple[int, float]] = []
    try:
        embedder = Embedder(settings.embedding_model)
        vector_hits = store.search_vector(embedder.embed_query(question), k * 2)
    except RuntimeError as error:
        log.warning("semantic search unavailable (%s); using keywords only", error)

    results = []
    for item_id in _fuse(vector_hits, keyword_hits)[:k]:
        item = store.get_item(item_id)
        analysis = store.get_analysis(item_id)
        if item is None or analysis is None:
            continue
        results.append(
            {
                "item_id": item_id,
                "url": item["url"],
                "author": item["author"],
                "title": analysis["title"],
                "summary": analysis["summary"],
                "category": analysis["category"],
                "key_points": json.loads(analysis["key_points"]),
                "tags": json.loads(analysis["tags"]),
                "actionable": bool(analysis["actionable"]),
            }
        )
    return results


def format_results(results: list[dict]) -> str:
    lines = []
    for index, result in enumerate(results, start=1):
        points = "\n".join(f"  - {point}" for point in result["key_points"])
        lines.append(
            f"[{index}] {result['title']}  ({result['category']})\n"
            f"  {result['url']}\n"
            f"  {result['summary']}\n{points}"
        )
    return "\n\n".join(lines)


def run(
    store: Store,
    settings: Settings,
    question: str,
    k: int = 8,
    answer: bool = True,
) -> str:
    results = retrieve(store, settings, question, k)
    if not results:
        return "No saved videos matched that question yet."

    listing = format_results(results)
    if not answer:
        return listing

    client = ClaudeClient(settings)
    excerpts = [
        f"[{index}] {result['title']} ({result['category']}) {result['url']}\n"
        f"{result['summary']}\n" + "\n".join(f"- {p}" for p in result["key_points"])
        for index, result in enumerate(results, start=1)
    ]
    try:
        completion = client.complete(
            SEARCH_SYSTEM, build_search_prompt(question, excerpts), max_tokens=2000
        )
    except AnalysisError as error:
        log.error("could not generate an answer: %s", error)
        return listing

    store.record_usage(
        "search",
        client.model,
        completion.input_tokens,
        completion.output_tokens,
        completion.cost_usd,
    )
    return f"{completion.text}\n\n--- sources ---\n\n{listing}"
