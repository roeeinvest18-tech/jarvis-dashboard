from __future__ import annotations

import argparse
import logging
import sys

from second_brain import logging_setup, report
from second_brain.config import Settings
from second_brain.db.store import open_store
from second_brain.sources import available_sources
from second_brain.stages import analyze, download, embed, frames, parse_export, search
from second_brain.stages import taxonomy as taxonomy_stage
from second_brain.stages import transcribe
from second_brain.stages.base import StageResult

log = logging.getLogger("second_brain")

FIRST_RUN_LIMIT = 25
PIPELINE = ["parse-export", "download", "transcribe", "frames", "analyze", "embed"]


def _add_limit(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--limit", type=int, default=None, help="process at most N items in this stage"
    )


def _add_retry(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="also re-attempt items this stage failed on earlier",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="second_brain",
        description="Ingest saved videos into a searchable second brain.",
    )
    parser.add_argument("--verbose", action="store_true", help="debug-level logging")
    subparsers = parser.add_subparsers(dest="command", required=True)

    parse_cmd = subparsers.add_parser(
        "parse-export", help="read the export and register saved items"
    )
    _add_limit(parse_cmd)
    parse_cmd.add_argument(
        "--source", default="instagram", choices=available_sources(), help="which source"
    )

    for name, help_text in (
        ("download", "fetch videos with yt-dlp"),
        ("transcribe", "transcribe audio with faster-whisper"),
        ("frames", "extract evenly spaced frames with ffmpeg"),
        ("embed", "build embeddings and the full-text index"),
    ):
        stage_cmd = subparsers.add_parser(name, help=help_text)
        _add_limit(stage_cmd)
        _add_retry(stage_cmd)

    analyze_cmd = subparsers.add_parser("analyze", help="summarise and categorise with Claude")
    _add_limit(analyze_cmd)
    _add_retry(analyze_cmd)
    analyze_cmd.add_argument(
        "--delete-videos",
        action="store_true",
        help="delete each video file once its analysis is stored",
    )

    taxonomy_cmd = subparsers.add_parser("taxonomy", help="propose or approve categories")
    taxonomy_sub = taxonomy_cmd.add_subparsers(dest="taxonomy_command", required=True)
    propose_cmd = taxonomy_sub.add_parser("propose", help="draft categories from analyses")
    _add_limit(propose_cmd)
    taxonomy_sub.add_parser("approve", help="promote the proposal to the live taxonomy")

    reclassify_cmd = subparsers.add_parser(
        "reclassify", help="re-file analysed videos against the approved taxonomy"
    )
    _add_limit(reclassify_cmd)
    reclassify_cmd.add_argument(
        "--force", action="store_true", help="re-file even items already on this version"
    )

    search_cmd = subparsers.add_parser("search", help="ask a question over saved content")
    search_cmd.add_argument("question", help="natural language question")
    search_cmd.add_argument("-k", type=int, default=8, help="how many videos to retrieve")
    search_cmd.add_argument(
        "--no-answer", action="store_true", help="list matches without asking Claude"
    )

    subparsers.add_parser("report", help="print the pipeline status report")

    run_cmd = subparsers.add_parser("run", help="run every stage in order, then report")
    run_cmd.add_argument(
        "--limit",
        type=int,
        default=FIRST_RUN_LIMIT,
        help=f"process at most N items per stage (default {FIRST_RUN_LIMIT})",
    )
    run_cmd.add_argument("--delete-videos", action="store_true")
    run_cmd.add_argument(
        "--skip",
        nargs="*",
        default=[],
        choices=PIPELINE,
        help="stages to leave out of this run",
    )
    return parser


def _run_pipeline(store, settings, args) -> list[StageResult]:
    results: list[StageResult] = []
    for stage in PIPELINE:
        if stage in args.skip:
            log.info("skipping %s", stage)
            continue
        log.info("--- %s ---", stage)
        if stage == "parse-export":
            results.append(parse_export.run(store, settings, args.limit))
        elif stage == "download":
            results.append(download.run(store, settings, args.limit))
        elif stage == "transcribe":
            results.append(transcribe.run(store, settings, args.limit))
        elif stage == "frames":
            results.append(frames.run(store, settings, args.limit))
        elif stage == "analyze":
            results.append(
                analyze.run(
                    store, settings, args.limit, delete_videos=args.delete_videos
                )
            )
        elif stage == "embed":
            results.append(embed.run(store, settings, args.limit))
    return results


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings.load()
    settings.ensure_directories()
    log_file = logging_setup.configure(settings.log_dir, args.verbose)
    log.debug("logging to %s", log_file)

    store = open_store(settings.db_path)
    results: list[StageResult] = []
    try:
        if args.command == "parse-export":
            results.append(parse_export.run(store, settings, args.limit, args.source))
        elif args.command == "download":
            results.append(download.run(store, settings, args.limit, args.retry_failed))
        elif args.command == "transcribe":
            results.append(transcribe.run(store, settings, args.limit, args.retry_failed))
        elif args.command == "frames":
            results.append(frames.run(store, settings, args.limit, args.retry_failed))
        elif args.command == "analyze":
            results.append(
                analyze.run(
                    store, settings, args.limit, args.retry_failed, args.delete_videos
                )
            )
        elif args.command == "embed":
            results.append(embed.run(store, settings, args.limit, args.retry_failed))
        elif args.command == "taxonomy":
            if args.taxonomy_command == "propose":
                results.append(taxonomy_stage.propose(store, settings, args.limit))
            else:
                results.append(taxonomy_stage.approve(settings))
        elif args.command == "reclassify":
            results.append(
                taxonomy_stage.reclassify(store, settings, args.limit, args.force)
            )
        elif args.command == "search":
            print(search.run(store, settings, args.question, args.k, not args.no_answer))
            return 0
        elif args.command == "run":
            results = _run_pipeline(store, settings, args)

        print(report.render(store, settings, results))
        return 1 if any(result.failed for result in results) else 0
    except (RuntimeError, FileNotFoundError) as error:
        log.error("%s", error)
        return 2
    finally:
        store.close()


if __name__ == "__main__":
    sys.exit(main())
