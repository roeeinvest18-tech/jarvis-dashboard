from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path

_FORMAT = "%(asctime)s %(levelname)-7s %(name)-22s %(message)s"
_DATE_FORMAT = "%H:%M:%S"


def configure(log_dir: Path, verbose: bool = False) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{datetime.now():%Y-%m-%d}.log"

    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    root.handlers.clear()

    console = logging.StreamHandler(sys.stderr)
    console.setLevel(logging.DEBUG if verbose else logging.INFO)
    console.setFormatter(logging.Formatter(_FORMAT, _DATE_FORMAT))
    root.addHandler(console)

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter(_FORMAT, "%Y-%m-%d %H:%M:%S"))
    root.addHandler(file_handler)

    for noisy in ("httpx", "httpx2", "urllib3", "sentence_transformers", "faster_whisper"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    return log_file
