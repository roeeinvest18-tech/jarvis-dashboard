import json

import pytest

from second_brain import report
from second_brain.analysis.claude_client import AnalysisError, Completion
from second_brain.analysis.prompts import analysis_schema, build_analysis_content
from second_brain.config import Settings
from second_brain.db.store import STATUS_DONE, open_store
from second_brain.sources.base import MEDIA_VIDEO, SourceItem
from second_brain.stages import analyze

ANALYSIS = {
    "title": "אפיית לחם מחמצת",
    "summary": "הסרטון מראה איך לאפות לחם מחמצת בתנור ביתי.",
    "key_points": ["להתפיח שמונה שעות", "תנור 240 מעלות"],
    "category": "בישול ואפייה",
    "tags": ["אפייה", "מחמצת"],
    "language": "he",
    "actionable": True,
}


class StubClient:
    model = "claude-opus-5"

    def __init__(self, settings, payload=None, error=None):
        self.calls = []
        self._payload = payload if payload is not None else ANALYSIS
        self._error = error

    def complete(self, system, content, schema=None, max_tokens=4000, effort="medium"):
        self.calls.append({"system": system, "content": content, "schema": schema})
        if self._error:
            raise self._error
        return Completion(
            text=json.dumps(self._payload, ensure_ascii=False),
            input_tokens=1200,
            output_tokens=300,
            cost_usd=0.0135,
        )


@pytest.fixture
def prepared(tmp_path, monkeypatch):
    monkeypatch.setenv("SECOND_BRAIN_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    settings = Settings.load()
    settings.categories_file = tmp_path / "categories.yaml"
    settings.proposed_categories_file = tmp_path / "categories.proposed.yaml"
    settings.ensure_directories()

    store = open_store(settings.db_path)
    item_id, _ = store.upsert_item(
        SourceItem(
            source="instagram",
            source_id="abc123",
            url="https://www.instagram.com/reel/abc123/",
            author="baker",
            caption="לחם מחמצת",
            media_type=MEDIA_VIDEO,
        )
    )
    store.set_status(item_id, "download", STATUS_DONE)
    store.save_transcript(item_id, "מערבבים קמח ומים", "he", 0.98, "medium", [])
    store.set_status(item_id, "transcribe", STATUS_DONE)

    frame = tmp_path / "frame_00.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xdb fake jpeg")
    store.save_frames(item_id, [(0, str(frame), 1.5)])
    store.set_status(item_id, "frames", STATUS_DONE)

    yield store, settings, item_id
    store.close()


def test_analyze_stores_result_and_cost(prepared, monkeypatch):
    store, settings, item_id = prepared
    stub = {}
    monkeypatch.setattr(
        analyze, "ClaudeClient", lambda s: stub.setdefault("client", StubClient(s))
    )

    result = analyze.run(store, settings, limit=5)

    assert (result.succeeded, result.failed) == (1, 0)
    stored = store.get_analysis(item_id)
    assert stored["title"] == ANALYSIS["title"]
    assert json.loads(stored["key_points"]) == ANALYSIS["key_points"]
    assert store.get_item(item_id)["analyze_status"] == "done"
    assert store.usage_totals()[0]["cost_usd"] == pytest.approx(0.0135)


def test_analyze_is_idempotent(prepared, monkeypatch):
    store, settings, _ = prepared
    monkeypatch.setattr(analyze, "ClaudeClient", StubClient)

    analyze.run(store, settings, limit=5)
    second = analyze.run(store, settings, limit=5)

    assert second.processed == 0


def test_analyze_marks_failure_without_losing_the_item(prepared, monkeypatch):
    store, settings, item_id = prepared
    monkeypatch.setattr(
        analyze,
        "ClaudeClient",
        lambda s: StubClient(s, error=AnalysisError("rate limited by the Claude API")),
    )

    result = analyze.run(store, settings, limit=5)

    assert (result.succeeded, result.failed) == (0, 1)
    item = store.get_item(item_id)
    assert item["analyze_status"] == "failed"
    assert "rate limited" in item["analyze_error"]
    assert len(store.pending_items("analyze", include_failed=True)) == 1


def test_delete_videos_removes_the_file(prepared, monkeypatch, tmp_path):
    store, settings, item_id = prepared
    video = tmp_path / "abc123.mp4"
    video.write_bytes(b"fake")
    store.set_media_details(item_id, str(video), 30.0, None, None)
    monkeypatch.setattr(analyze, "ClaudeClient", StubClient)

    analyze.run(store, settings, limit=5, delete_videos=True)

    assert not video.exists()
    assert store.get_item(item_id)["video_deleted"] == 1


def test_prompt_content_carries_frames_then_text(tmp_path):
    frame = tmp_path / "frame.jpg"
    frame.write_bytes(b"\xff\xd8\xff\xdb fake jpeg")

    content = build_analysis_content(
        url="https://www.instagram.com/reel/abc123/",
        author="baker",
        caption="לחם מחמצת",
        transcript="מערבבים קמח ומים",
        transcript_language="he",
        frame_paths=[frame],
        taxonomy=None,
    )

    assert content[0]["type"] == "image"
    assert content[-1]["type"] == "text"
    assert "מערבבים קמח ומים" in content[-1]["text"]
    assert "No category list exists yet" in content[-1]["text"]


def test_schema_is_open_until_a_taxonomy_exists():
    assert "enum" not in analysis_schema(None)["properties"]["category"]


def test_report_renders_after_a_run(prepared, monkeypatch):
    store, settings, _ = prepared
    monkeypatch.setattr(analyze, "ClaudeClient", StubClient)
    result = analyze.run(store, settings, limit=5)

    text = report.render(store, settings, [result])

    assert "SECOND BRAIN - RUN REPORT" in text
    assert "claude-opus-5" in text
