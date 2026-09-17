from __future__ import annotations

import base64
import json
from pathlib import Path

from second_brain.analysis.categories import Taxonomy

MAX_TRANSCRIPT_CHARS = 20000

ANALYSIS_SYSTEM = """\
You catalogue short videos a person saved for later, for a personal knowledge base.

You receive the post caption, the audio transcript, and a handful of evenly spaced frames
that often carry on-screen text. Read the frames for text the transcript misses.

Rules:
- Write the title, summary and key points in the dominant language of the video itself
  (Hebrew content stays Hebrew, English stays English).
- The summary is 3 to 5 sentences describing what the video actually teaches or shows,
  not what it promises. Never write "this video discusses" filler.
- key_points are concrete takeaways: steps, numbers, names, claims. 2 to 6 of them.
- tags are 3 to 8 short lowercase topic labels in the video's language.
- actionable is true only when the viewer could follow a concrete instruction, recipe,
  exercise, setting or purchase from the video.
- If the material is too thin to judge, say so plainly in the summary rather than inventing.\
"""

TAXONOMY_SYSTEM = """\
You design a category taxonomy for a personal knowledge base of saved videos.

You receive the free-form categories and tags a first analysis pass produced. Propose a
flat list of 8 to 14 categories that covers this material with as little overlap as
possible. Categories must be about subject matter, not format or quality. Merge near
duplicates. Name them in the language the material itself mostly uses. Every category gets
a one-sentence description saying what belongs in it and what does not.\
"""

RECLASSIFY_SYSTEM = """\
You assign one category from a fixed list to an already summarised video. Choose the single
best fit. If nothing fits well, choose the closest category rather than inventing a new one.\
"""

SEARCH_SYSTEM = """\
You answer questions about a person's saved videos using only the excerpts provided.

Cite the videos you used by their bracketed number, e.g. [3]. If the excerpts do not answer
the question, say so instead of guessing. Answer in the language of the question. Keep it
short: a direct answer first, then the supporting detail.\
"""


def analysis_schema(taxonomy: Taxonomy | None) -> dict:
    category: dict = {"type": "string"}
    if taxonomy:
        category = {"type": "string", "enum": taxonomy.names}
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "key_points": {"type": "array", "items": {"type": "string"}},
            "category": category,
            "tags": {"type": "array", "items": {"type": "string"}},
            "language": {"type": "string"},
            "actionable": {"type": "boolean"},
        },
        "required": [
            "title",
            "summary",
            "key_points",
            "category",
            "tags",
            "language",
            "actionable",
        ],
        "additionalProperties": False,
    }


def taxonomy_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "categories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "description": {"type": "string"},
                    },
                    "required": ["name", "description"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["categories"],
        "additionalProperties": False,
    }


def reclassify_schema(taxonomy: Taxonomy) -> dict:
    return {
        "type": "object",
        "properties": {"category": {"type": "string", "enum": taxonomy.names}},
        "required": ["category"],
        "additionalProperties": False,
    }


def _image_block(path: Path) -> dict:
    data = base64.standard_b64encode(path.read_bytes()).decode("utf-8")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/jpeg", "data": data},
    }


def build_analysis_content(
    url: str,
    author: str | None,
    caption: str | None,
    transcript: str | None,
    transcript_language: str | None,
    frame_paths: list[Path],
    taxonomy: Taxonomy | None,
) -> list[dict]:
    content: list[dict] = [_image_block(path) for path in frame_paths if path.exists()]

    parts = [f"Post URL: {url}"]
    if author:
        parts.append(f"Author: {author}")
    parts.append(f"Caption:\n{caption.strip() if caption else '(none)'}")
    if transcript:
        clipped = transcript[:MAX_TRANSCRIPT_CHARS]
        language = transcript_language or "unknown"
        parts.append(f"Transcript (detected language: {language}):\n{clipped}")
    else:
        parts.append("Transcript: (none - the video had no usable speech)")
    parts.append(
        f"Frames attached: {len(content)}, evenly spaced through the video."
        if content
        else "Frames attached: none."
    )
    if taxonomy:
        parts.append(
            "Choose category from this approved list only:\n" + taxonomy.as_prompt_block()
        )
    else:
        parts.append(
            "No category list exists yet. Invent the most natural subject category for this"
            " video; a taxonomy will be derived from these answers later."
        )

    content.append({"type": "text", "text": "\n\n".join(parts)})
    return content


def build_taxonomy_prompt(rows: list[dict]) -> str:
    lines = [
        f"- category: {row['category']} | tags: {', '.join(row['tags'])} | title: {row['title']}"
        for row in rows
    ]
    return (
        f"These are the free-form categories from {len(rows)} analysed videos:\n\n"
        + "\n".join(lines)
    )


def build_reclassify_prompt(analysis: dict, taxonomy: Taxonomy) -> str:
    return (
        f"Title: {analysis['title']}\n"
        f"Summary: {analysis['summary']}\n"
        f"Key points: {json.dumps(analysis['key_points'], ensure_ascii=False)}\n"
        f"Tags: {', '.join(analysis['tags'])}\n"
        f"Previous free-form category: {analysis['category']}\n\n"
        f"Approved categories:\n{taxonomy.as_prompt_block()}"
    )


def build_search_prompt(question: str, excerpts: list[str]) -> str:
    joined = "\n\n".join(excerpts)
    return f"Question: {question}\n\nSaved videos:\n\n{joined}"
