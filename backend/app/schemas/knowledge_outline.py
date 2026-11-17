from pydantic import Field

from app.schemas.base import BaseModel


class KnowledgeOutlineFields(BaseModel):
    parent_knowledge_point_id: int | None = None
    chapter_id: int | None = None
    chapter_name: str | None = None
    outline_path: list[str] = Field(default_factory=list)
    outline_depth: int = 0
    outline_order: int = 0
