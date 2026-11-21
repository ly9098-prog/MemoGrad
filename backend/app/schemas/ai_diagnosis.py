from typing import Literal

from app.schemas.base import BaseModel


class WeakPoint(BaseModel):
    knowledge_point: str
    accuracy: float
    suggestion: str


class StrongPoint(BaseModel):
    knowledge_point: str
    accuracy: float
    suggestion: str


class AiDiagnosis(BaseModel):
    weak_points: list[WeakPoint] = []
    strong_points: list[StrongPoint] = []
    learning_suggestions: list[str] = []
    summary: str = ""
    generated: bool = False
    status: Literal["pending", "ready"] = "ready"
