from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class StageResult:
    stage: str
    processed: int = 0
    succeeded: int = 0
    failed: int = 0
    skipped: int = 0
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return (
            f"{self.stage}: {self.processed} processed, {self.succeeded} ok,"
            f" {self.failed} failed, {self.skipped} skipped"
        )
