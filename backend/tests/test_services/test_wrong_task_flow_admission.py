"""Task-flow counts stay complete while question hydration stays bounded."""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from app.models.admin import QuestionVersion
from app.models.question import Question
from app.models.review_scheduler import ReviewSchedule
from app.models.wrong_question import WrongQuestion
from app.services import wrong_question_service as service
from tests.test_features.test_wrong_question_batch import _add_user, _close_db, _make_db


@pytest.mark.asyncio
async def test_large_book_counts_all_rows_but_only_hydrates_group_previews(monkeypatch):
    engine, db, path = await _make_db()
    now = datetime(2026, 11, 19, 3)
    monkeypatch.setattr(service, "utcnow", lambda: now)
    monkeypatch.setattr(service, "shanghai_today_boundaries", lambda: (now, now))
    kp_loader = AsyncMock(return_value={})
    monkeypatch.setattr(service, "load_question_kps", kp_loader)
    projected = []
    real_project = service._wrong_list_item

    def project(row, kp_map):
        projected.append(row[0].id)
        return real_project(row, kp_map)

    monkeypatch.setattr(service, "_wrong_list_item", project)
    try:
        await _add_user(db, 1)
        await _add_user(db, 2)
        expected = {key: [] for key, _ in service._TASK_FLOW_GROUPS}
        for index in range(604):
            qid, revision = 1000 + index, 901000 + index
            bucket = index % 5
            db.add(Question(
                id=qid, subject_id=1, content={"text": f"question {index}"}, answer="A",
                is_active=index != 600,
                review_status="draft" if index == 601 else "approved",
                current_version_id=revision,
            ))
            db.add(QuestionVersion(
                id=revision, question_id=qid, version=1,
                content={"text": "revision"}, answer="A", difficulty=3,
            ))
            db.add(WrongQuestion(
                id=qid, user_id=2 if index == 602 else 1,
                question_id=qid, question_version_id=revision, wrong_answer="B",
                review_count=5 if bucket in (0, 1) else 1, mastered=bucket == 4,
                is_active=index != 603, updated_at=now,
                created_at=now - timedelta(days=60 if bucket == 3 else 1),
            ))
            if index < 600:
                expected[service._TASK_FLOW_GROUPS[bucket][0]].append(qid)
            if bucket == 0:
                db.add(ReviewSchedule(
                    user_id=1, question_id=qid, question_version_id=revision,
                    next_review_at=now - timedelta(hours=1), mastered=False,
                ))
        await db.commit()

        flow = await service.get_task_flow(db, 1, preview_size=2)

        assert flow["summary"] == {
            "total_count": 600, "mastered_count": 120,
            "high_frequency_count": 240, "today_due_count": 120,
        }
        assert len(projected) == 10
        assert len(kp_loader.await_args.args[1]) == 10
        for group in flow["groups"]:
            assert group["total"] == 120
            assert [item["id"] for item in group["items"]] == sorted(
                expected[group["key"]], reverse=True
            )[:2]
    finally:
        await _close_db(engine, db, path)
