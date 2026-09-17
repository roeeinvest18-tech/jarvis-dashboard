from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Input / output price per million tokens, used for the cost estimate in the report.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-opus-5": (5.00, 25.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-haiku-4-5": (1.00, 5.00),
}


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(REPO_ROOT / ".env")


def _path(value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else REPO_ROOT / path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Settings:
    data_dir: Path
    export_dir: Path
    db_path: Path
    video_dir: Path
    frame_dir: Path
    log_dir: Path
    categories_file: Path
    proposed_categories_file: Path

    model: str
    api_key: str | None

    cookies_browser: str
    download_min_delay: float
    download_max_delay: float

    whisper_model: str
    whisper_device: str
    whisper_compute_type: str

    embedding_model: str
    embedding_dimensions: int

    frames_per_video: int

    directories: list[Path] = field(default_factory=list)

    @classmethod
    def load(cls) -> Settings:
        _load_dotenv()
        data_dir = _path(_env("SECOND_BRAIN_DATA_DIR", "data"))
        frames = int(_env("SECOND_BRAIN_FRAMES_PER_VIDEO", "5"))
        return cls(
            data_dir=data_dir,
            export_dir=_path(_env("SECOND_BRAIN_EXPORT_DIR", "data/instagram_export")),
            db_path=data_dir / "second_brain.db",
            video_dir=data_dir / "videos",
            frame_dir=data_dir / "frames",
            log_dir=data_dir / "logs",
            categories_file=REPO_ROOT / "config" / "categories.yaml",
            proposed_categories_file=REPO_ROOT / "config" / "categories.proposed.yaml",
            model=_env("SECOND_BRAIN_MODEL", "claude-opus-5"),
            api_key=os.environ.get("ANTHROPIC_API_KEY"),
            cookies_browser=_env("SECOND_BRAIN_COOKIES_BROWSER", "chrome"),
            download_min_delay=float(_env("SECOND_BRAIN_DOWNLOAD_MIN_DELAY", "5")),
            download_max_delay=float(_env("SECOND_BRAIN_DOWNLOAD_MAX_DELAY", "15")),
            whisper_model=_env("SECOND_BRAIN_WHISPER_MODEL", "medium"),
            whisper_device=_env("SECOND_BRAIN_WHISPER_DEVICE", "cpu"),
            whisper_compute_type=_env("SECOND_BRAIN_WHISPER_COMPUTE_TYPE", "int8"),
            embedding_model=_env(
                "SECOND_BRAIN_EMBEDDING_MODEL", "intfloat/multilingual-e5-base"
            ),
            embedding_dimensions=int(_env("SECOND_BRAIN_EMBEDDING_DIMENSIONS", "768")),
            frames_per_video=max(4, min(6, frames)),
        )

    def ensure_directories(self) -> None:
        for directory in (
            self.data_dir,
            self.video_dir,
            self.frame_dir,
            self.log_dir,
            self.categories_file.parent,
        ):
            directory.mkdir(parents=True, exist_ok=True)

    def price_per_million(self) -> tuple[float, float]:
        return MODEL_PRICING.get(self.model, (5.00, 25.00))
