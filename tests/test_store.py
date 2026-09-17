import pytest

from second_brain.db.store import STATUS_DONE, STATUS_FAILED, open_store
from second_brain.sources.base import MEDIA_VIDEO, SourceItem


def make_item(source_id: str = "abc123") -> SourceItem:
    return SourceItem(
        source="instagram",
        source_id=source_id,
        url=f"https://www.instagram.com/reel/{source_id}/",
        author="someone",
        saved_at="2026-01-01T00:00:00+00:00",
        media_type=MEDIA_VIDEO,
        raw={"href": "x"},
    )


@pytest.fixture
def store(tmp_path):
    store = open_store(tmp_path / "test.db")
    yield store
    store.close()


def test_upsert_is_idempotent(store):
    first_id, created = store.upsert_item(make_item())
    second_id, created_again = store.upsert_item(make_item())

    assert created is True
    assert created_again is False
    assert first_id == second_id
    assert store.item_total() == 1


def test_pending_items_respect_stage_prerequisites(store):
    item_id, _ = store.upsert_item(make_item())

    assert [row["id"] for row in store.pending_items("download")] == [item_id]
    assert store.pending_items("transcribe") == []

    store.set_status(item_id, "download", STATUS_DONE)
    assert [row["id"] for row in store.pending_items("transcribe")] == [item_id]


def test_failed_items_return_only_with_retry_flag(store):
    item_id, _ = store.upsert_item(make_item())
    store.set_status(item_id, "download", STATUS_FAILED, "cookies expired")

    assert store.pending_items("download") == []
    assert len(store.pending_items("download", include_failed=True)) == 1
    assert store.get_item(item_id)["download_error"] == "cookies expired"


def test_limit_caps_the_batch(store):
    for index in range(5):
        store.upsert_item(make_item(f"item{index}"))

    assert len(store.pending_items("download", limit=2)) == 2


def test_analysis_round_trip_and_usage(store):
    item_id, _ = store.upsert_item(make_item())
    store.save_analysis(
        item_id,
        {
            "title": "כיצד לאפות לחם",
            "summary": "שלוש משפטים.",
            "key_points": ["להתפיח שעה", "תנור 240 מעלות"],
            "category": "אוכל",
            "tags": ["אפייה", "לחם"],
            "language": "he",
            "actionable": True,
        },
        model="claude-opus-5",
        taxonomy_version=None,
    )
    store.record_usage("analyze", "claude-opus-5", 1000, 200, 0.01, item_id)

    analysis = store.get_analysis(item_id)
    assert analysis["title"] == "כיצד לאפות לחם"
    assert analysis["actionable"] == 1
    assert store.usage_totals()[0]["cost_usd"] == pytest.approx(0.01)


def test_stage_counts_cover_every_stage(store):
    item_id, _ = store.upsert_item(make_item())
    store.set_status(item_id, "download", STATUS_DONE)

    counts = store.stage_counts()
    assert counts["download"] == {"done": 1}
    assert counts["analyze"] == {"pending": 1}


def test_unknown_stage_is_rejected(store):
    item_id, _ = store.upsert_item(make_item())
    with pytest.raises(ValueError):
        store.set_status(item_id, "drop table items", STATUS_DONE)
