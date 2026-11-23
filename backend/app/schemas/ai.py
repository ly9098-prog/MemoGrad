from typing import Literal

from pydantic import Field, PositiveInt

from app.schemas.base import BaseModel


class ErrorAnalysisRequest(BaseModel):
    wrong_question_id: int
    force_regenerate: bool = False


class StudyAdviceRequest(BaseModel):
    subject_id: int | None = None


class AiModelAvailabilityResponse(BaseModel):
    status: Literal["checking", "available", "unavailable"]
    enabled: bool
    reason: str
    message: str
    retry_after_ms: int


class AiResponse(BaseModel):
    session_type: str
    content: dict
    tokens_used: int
    model: str
    duration_ms: int
    from_cache: bool = False
    from_fallback: bool = False
    force_regenerated: bool = False
    cache_preserved: bool = False
    visual_input_count: int = 0
    visual_evidence: str | None = None
    error_code: str | None = None
    retryable: bool | None = None
    generated_at: str | None = None
    availability: AiModelAvailabilityResponse | None = None
    message: str | None = None
    limit_dimension: str | None = None
    limit_value: int | None = None
    retry_after_seconds: int | None = None


class AiRecoveryRequest(BaseModel):
    wrong_question_id: int
    force_regenerate: bool = False
    baseline_generated_at: str | None = None


class AiRecoveryResponse(BaseModel):
    queued: bool


class AiAnalysisStatusResponse(BaseModel):
    ready: bool
    content: dict | None = None
    generated_at: str | None = None


class AiPrewarmRequest(BaseModel):
    wrong_question_ids: list[PositiveInt] = Field(min_length=1, max_length=50)


class AiPrewarmResponse(BaseModel):
    queued: list[int]
    skipped: list[int]
    reason: str = "ok"


class AiChatRecord(BaseModel):
    id: int
    session_type: str
    user_message: str
    ai_response: str
    tokens_used: int
    created_at: str


class AiFeedbackRequest(BaseModel):
    source: str = Field(min_length=1, max_length=32)  # 'dashboard' | 'wrong_book'
    feedback_type: str = Field(min_length=1, max_length=64)
    question_id: int | None = None
    detail: str | None = Field(default=None, max_length=2000)
