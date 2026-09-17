# Jarvis Second Brain - Phase 1: Instagram saved videos

Ingests saved Instagram videos, transcribes and reads them, summarises and categorises
them with Claude, and stores everything in a searchable SQLite database.

Each pipeline stage is a separate module with its own CLI command. Every item carries a
status per stage, so any stage can be interrupted and resumed without repeating work.

```
parse-export -> download -> transcribe -> frames -> analyze -> embed -> search
   export        yt-dlp     faster-whisper  ffmpeg   Claude    local     hybrid
   JSON                                              API       vectors   retrieval
```

## Requirements

- Python 3.11 or newer
- `ffmpeg` and `ffprobe` on `PATH`
- Chrome logged in to Instagram, on the same machine (yt-dlp reads its cookies)
- An Anthropic API key

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# then put your ANTHROPIC_API_KEY in .env
```

Put the Instagram export where the pipeline looks for it:

```
data/instagram_export/          # unzipped "Download your information" export
data/videos/                    # downloaded videos (created automatically)
data/frames/                    # extracted frames
data/second_brain.db            # the database
data/logs/                      # one log file per day
```

The whole `data/` directory is gitignored. Every path is overridable in `.env`.

## First run

Keep the first pass small, verify the results, then scale up:

```bash
python -m second_brain run --limit 25
```

`run` executes every stage in order and prints the report. It costs roughly $0.05 to
$0.15 per video with `claude-opus-5`, depending on video length; the report shows the
measured estimate.

## Stage by stage

Every stage takes `--limit N`. Every media stage also takes `--retry-failed`.

```bash
python -m second_brain parse-export --limit 25   # read the export, register items
python -m second_brain download --limit 25       # yt-dlp, 5-15s random delay between videos
python -m second_brain transcribe --limit 25     # faster-whisper, auto language detection
python -m second_brain frames --limit 25         # 4-6 evenly spaced frames per video
python -m second_brain analyze --limit 25        # Claude: title, summary, key points, category
python -m second_brain embed --limit 25          # local embeddings + full-text index
python -m second_brain report                    # status, failures, cost estimate
```

Re-running a stage only picks up items that are still `pending` for it, so an interrupted
run continues where it stopped. Add `--retry-failed` to re-attempt the failures.

To save disk space, delete each video once its analysis is stored:

```bash
python -m second_brain analyze --limit 25 --delete-videos
```

## Categories

The first analysis pass invents its own category per video. Once a batch exists, derive a
taxonomy from it:

```bash
python -m second_brain taxonomy propose      # writes config/categories.proposed.yaml
# review and edit that file
python -m second_brain taxonomy approve      # copies it to config/categories.yaml
python -m second_brain reclassify            # re-files every analysed video
```

From then on `analyze` constrains the category to the approved list. `config/categories.yaml`
is yours to edit at any time - rename, merge or add categories and run `reclassify` again.
Reclassification is text-only, so it is far cheaper than re-analysing.

## Search

```bash
python -m second_brain search "מה שמרתי על אפייה בתנור ביתי?"
python -m second_brain search "sourdough recipes" --no-answer -k 15
```

Retrieval fuses semantic search (multilingual embeddings in `sqlite-vec`) with keyword
search (SQLite FTS5), then Claude answers from the retrieved videos and cites them by
number. `--no-answer` prints the matches without calling the API.

Embeddings are computed locally with `intfloat/multilingual-e5-base`, so Hebrew and English
share one vector space and a Hebrew question can find an English video. If `sqlite-vec`
cannot load on your platform, the pipeline logs a warning and search falls back to
keywords only.

## Data model

One `items` row per saved item, from any source, with a status triplet
(`<stage>_status`, `<stage>_error`, `<stage>_at`) per stage. Stage output lives in
`transcripts`, `frames`, `analyses`, `vec_items` and `items_fts`; `api_usage` records
tokens and cost per call.

Nothing in the schema is Instagram-specific: `source` plus `source_id` identify an item,
and the platform's raw record is kept in `raw_metadata` for later reference. That is what a
website or assistant on top of this database will read.

## Adding another source

Implement `Source` in `second_brain/sources/`, yield `SourceItem` objects, and decorate the
class with `@register`:

```python
@register
class YouTubeWatchLater(Source):
    name = "youtube"

    def iter_items(self) -> Iterator[SourceItem]:
        ...
```

It then appears in `parse-export --source youtube`. Everything downstream - download,
transcription, frames, analysis, search - already works on any source, because those stages
only ever see `items` rows.

## Troubleshooting

**Downloads fail with a login or rate-limit error.** Instagram cookies expire. Open
Instagram in Chrome, then retry with `--retry-failed`. The stage aborts itself after three
consecutive failures rather than burning through the queue.

**`sqlite-vec` will not load.** Some Python builds ship without extension support. Search
still works on keywords; to restore semantic search, use a Python built with
`--enable-loadable-sqlite-extensions` (the python.org and Homebrew builds have it).

**Transcription is slow.** `medium` on CPU runs at roughly two to three times real time.
With an NVIDIA GPU set `SECOND_BRAIN_WHISPER_DEVICE=cuda`,
`SECOND_BRAIN_WHISPER_COMPUTE_TYPE=float16` and `SECOND_BRAIN_WHISPER_MODEL=large-v3`.

**Costs.** `report` totals tokens and cost per stage from published per-token prices. Switch
models with `SECOND_BRAIN_MODEL` in `.env`.

## Tests

```bash
python -m pytest tests -q
```

The suite covers the export parser, the store's status and resume logic, and the analyze
stage against a stubbed Claude client. No network or API key required.
