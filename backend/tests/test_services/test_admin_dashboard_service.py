from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.admin_dashboard_service import get_dashboard_question_stats


def _result(rows):
    result = MagicMock()
    result.all.return_value = rows
    return result


@pytest.mark.asyncio
async def test_question_stats_returns_subject_names():
    db = MagicMock()
    db.execute = AsyncMock(
        side_effect=[
            _result([("数据结构", 12), ("计算机网络", 8)]),
            _result([("published", 20)]),
            _result([("easy", 10)]),
        ]
    )

    stats = await get_dashboard_question_stats(db)

    assert stats["by_subject"] == [
        {"name": "数据结构", "count": 12},
        {"name": "计算机网络", "count": 8},
    ]
    assert stats["by_review_status"] == [{"name": "published", "count": 20}]
    assert stats["by_difficulty"] == [{"name": "easy", "count": 10}]
