"""Home mastery keeps score, evidence confidence, and knowledge ownership distinct."""

from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.schemas.study_hub import StudyHubOverviewResponse
from app.services import study_hub_service as hub

SUBJECT = SimpleNamespace(id=3, code="data_structure", name="数据结构")


@pytest.mark.parametrize(
    ("score", "status"),
    [(28.0, "weak"), (39.9, "weak"), (40.0, "developing"), (69.9, "developing"),
     (70.0, "good"), (78.0, "good"), (84.9, "good"), (84.96, "good"),
     (85.0, "mastered"), (93.0, "mastered")],
)
def test_home_mastery_uses_the_existing_multi_level_scale(score, status):
    result = hub._subject_mastery_entry(SUBJECT, (3, score, 0.8, 12, 10, 2, 3))
    assert result["status"] == status
    assert result["mastery_score"] == round(score, 1)
    assert result["data_available"] is True


def test_high_score_with_little_evidence_is_not_declared_mastered():
    result = hub._subject_mastery_entry(SUBJECT, (3, 96.0, 0.1, 1, 1, 0, 1))
    assert result["status"] == "insufficient"
    assert result["mastery_score"] is None
    assert result["data_available"] is True


def test_display_rounding_does_not_promote_insufficient_confidence():
    result = hub._subject_mastery_entry(SUBJECT, (3, 91, 0.2999, 8, 8, 0, 3))
    assert result["confidence"] == 0.3
    assert result["status"] == "insufficient"
    assert result["mastery_score"] is None


def test_overview_response_keeps_mastery_status_and_observation_scope():
    entry = hub._subject_mastery_entry(SUBJECT, (3, 78.0, 0.8, 12, 10, 2, 3))
    response = StudyHubOverviewResponse(
        date="2026-11-19",
        primary_task={
            "key": "smart:practice", "task_type": "smart_practice", "priority": 1,
            "title": "继续练习", "reason": "保持训练节奏", "action_label": "开始练习",
            "route": "practice",
        },
        subject_mastery=[entry],
    ).model_dump(mode="json")
    assert response["subject_mastery"][0]["status"] == "good"
    assert response["subject_mastery"][0]["observed_point_count"] == 3
    assert response["subject_mastery"][0]["mastery_score"] == 78.0


def test_missing_mastery_stays_unknown_instead_of_becoming_zero():
    result = hub._subject_mastery_entry(SUBJECT, (3, None, 0.4, 4, 3, 1, 1))
    assert result["mastery_score"] is None
    assert result["data_available"] is True
    assert result["status"] == "insufficient"
    assert result["accuracy"] == 0.75
    assert hub._subject_mastery_entry(SUBJECT, None)["status"] == "no_data"


@pytest.mark.asyncio
@pytest.mark.parametrize("score,confidence,attempts,status", [(78, 0.8, 8, "good"), (91, 0, 100, "mastered")])
async def test_subject_ownership_is_read_from_active_knowledge_points(score, confidence, attempts, status):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            await connection.execute(text(
                "CREATE TABLE knowledge_points (id INTEGER PRIMARY KEY, "
                "subject_id INTEGER, is_active BOOLEAN)"
            ))
            await connection.execute(text(
                "CREATE TABLE user_knowledge_states (id INTEGER PRIMARY KEY, "
                "user_id INTEGER, subject_id INTEGER, knowledge_point_id INTEGER, "
                "mastery_score FLOAT, confidence FLOAT, attempt_count INTEGER, "
                "correct_count INTEGER, wrong_count INTEGER)"
            ))
            await connection.execute(text(
                "INSERT INTO knowledge_points VALUES (10,3,1),(11,4,1),(12,3,0)"
            ))
            await connection.execute(text(
                "INSERT INTO user_knowledge_states VALUES "
                "(1,7,4,10,:score,:confidence,:attempts,6,2),"
                "(2,7,3,11,25,.5,5,1,4),"  # Moved away from subject 3.
                "(3,7,3,12,0,1,10,0,10),"  # Inactive point must not lower Home.
                "(4,8,3,10,0,1,10,0,10)"   # Another user's evidence is isolated.
            ), {"score": score, "confidence": confidence, "attempts": attempts})
        async with AsyncSession(engine) as db:
            rows = await hub._build_subject_mastery(db, 7, [SUBJECT])
        assert rows[0]["mastery_score"] == score
        assert rows[0]["attempt_count"] == attempts
        assert rows[0]["status"] == status
        assert rows[0]["confidence"] == min(attempts / 10, 1)
    finally:
        await engine.dispose()
