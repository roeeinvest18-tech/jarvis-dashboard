from pathlib import Path

from second_brain.sources.base import MEDIA_UNKNOWN, MEDIA_VIDEO
from second_brain.sources.instagram import InstagramSavedPosts, repair_mojibake

FIXTURE_DIR = Path(__file__).parent / "fixtures" / "instagram_export"


def test_repair_mojibake_restores_hebrew():
    mangled = "××ª××× ××"
    assert repair_mojibake(mangled) == "מתכונים"


def test_repair_mojibake_leaves_clean_text_alone():
    assert repair_mojibake("cooking.channel") == "cooking.channel"


def test_parses_saved_posts_and_deduplicates():
    source = InstagramSavedPosts(FIXTURE_DIR)
    items = list(source.iter_items())

    assert [item.source_id for item in items] == [
        "CxAbC123_de",
        "DzQwErTy99",
        "AbCdEfGh01",
    ]


def test_media_type_inferred_from_url_shape():
    items = {item.source_id: item for item in InstagramSavedPosts(FIXTURE_DIR).iter_items()}

    assert items["CxAbC123_de"].media_type == MEDIA_VIDEO
    assert items["AbCdEfGh01"].media_type == MEDIA_VIDEO
    assert items["DzQwErTy99"].media_type == MEDIA_UNKNOWN


def test_non_post_urls_are_skipped_and_logged():
    source = InstagramSavedPosts(FIXTURE_DIR)
    list(source.iter_items())

    assert [skipped.reason for skipped in source.skipped] == ["not_a_post"]
    assert "some.profile" in source.skipped[0].detail


def test_author_and_timestamp_are_normalised():
    items = {item.source_id: item for item in InstagramSavedPosts(FIXTURE_DIR).iter_items()}

    assert items["DzQwErTy99"].author == "מתכונים"
    assert items["CxAbC123_de"].saved_at.startswith("2023-09-16")
    assert items["CxAbC123_de"].caption is None
