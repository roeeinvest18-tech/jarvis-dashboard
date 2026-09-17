from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator

MEDIA_VIDEO = "video"
MEDIA_IMAGE = "image"
MEDIA_UNKNOWN = "unknown"


@dataclass(frozen=True)
class SourceItem:
    """One saved item, normalised across sources."""

    source: str
    source_id: str
    url: str
    author: str | None = None
    caption: str | None = None
    saved_at: str | None = None
    media_type: str = MEDIA_UNKNOWN
    raw: dict = field(default_factory=dict)


@dataclass(frozen=True)
class SkippedItem:
    reason: str
    detail: str


class Source(ABC):
    """A place saved content comes from. One implementation per platform."""

    name: str

    @abstractmethod
    def iter_items(self) -> Iterator[SourceItem]:
        """Yield every saved item the source knows about."""

    @property
    def skipped(self) -> list[SkippedItem]:
        """Items the source deliberately did not yield, for logging."""
        return []


_REGISTRY: dict[str, type[Source]] = {}


def register(source_class: type[Source]) -> type[Source]:
    _REGISTRY[source_class.name] = source_class
    return source_class


def get_source_class(name: str) -> type[Source]:
    if name not in _REGISTRY:
        known = ", ".join(sorted(_REGISTRY)) or "none"
        raise KeyError(f"unknown source '{name}' (registered: {known})")
    return _REGISTRY[name]


def available_sources() -> list[str]:
    return sorted(_REGISTRY)
