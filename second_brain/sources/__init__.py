from pathlib import Path

from second_brain.sources import instagram  # noqa: F401 - registers the source
from second_brain.sources.base import (
    Source,
    SourceItem,
    available_sources,
    get_source_class,
)


def build_source(name: str, export_dir: Path) -> Source:
    return get_source_class(name)(export_dir)


__all__ = ["Source", "SourceItem", "available_sources", "build_source"]
