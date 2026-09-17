from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


@dataclass
class Taxonomy:
    version: str | None
    categories: list[dict[str, str]]

    @property
    def names(self) -> list[str]:
        return [category["name"] for category in self.categories]

    def as_prompt_block(self) -> str:
        return "\n".join(
            f"- {category['name']}: {category.get('description', '')}".rstrip()
            for category in self.categories
        )


def _require_yaml():
    try:
        import yaml
    except ImportError as error:
        raise RuntimeError(
            "PyYAML is not installed; run pip install -r requirements.txt"
        ) from error
    return yaml


def load_taxonomy(path: Path) -> Taxonomy | None:
    """Return the approved taxonomy, or None while categories are still free-form."""
    if not path.exists():
        return None
    yaml = _require_yaml()
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    categories = [
        category
        for category in payload.get("categories", [])
        if isinstance(category, dict) and category.get("name")
    ]
    if not categories:
        return None
    return Taxonomy(version=str(payload.get("version") or ""), categories=categories)


def write_taxonomy(path: Path, taxonomy: Taxonomy, header: str = "") -> None:
    yaml = _require_yaml()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.safe_dump(
        {"version": taxonomy.version, "categories": taxonomy.categories},
        allow_unicode=True,
        sort_keys=False,
    )
    path.write_text(f"{header}{body}", encoding="utf-8")
