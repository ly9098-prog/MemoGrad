"""Keep uncertain Redis delivery from rolling back a live import owner."""

from app.services.task_queue_contract import EnqueueResult


class ImportEnqueueUncertainError(RuntimeError):
    def __init__(self, owner_id: str) -> None:
        super().__init__(f"任务入队结果未确认，请查询任务状态后重试（{owner_id}）")
        self.owner_id = owner_id


def require_known_enqueue_outcome(result: EnqueueResult, owner_id: str) -> None:
    # Both connection loss and a read timeout can occur after Redis committed
    # the script. This legacy result shape carries no definitive rejection bit.
    if not result and result.reason in {
        "redis_unavailable",
        "internal_error",
        "enqueue_failed",
    }:
        raise ImportEnqueueUncertainError(owner_id)
