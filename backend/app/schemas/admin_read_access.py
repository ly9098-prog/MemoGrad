"""Safe response models for ordinary-user reads through Admin content APIs.

These models deliberately exclude import provenance, OCR source text, review
governance fields and graph diagnostics.  Administrator responses keep using
their existing schemas.
"""

from typing import Any, Literal

from pydantic import Field

from app.schemas.base import BaseModel


class VisibleQuestionListItem(BaseModel):
    id: int
    subject_id: int | None = None
    subject_code: str | None = None
    subject_name: str | None = None
    subject_path: str | None = None
    question_type: str
    content: dict[str, Any]
    options: dict[str, Any] | None = None
    answer: str
    analysis: str | None = None
    knowledge_points: list[str] = Field(default_factory=list)
    difficulty: int
    source: str | None = None
    image_url: list[Any] | None = None
    year: int | None = None
    is_active: Literal[True] = True


class VisibleQuestionDetail(VisibleQuestionListItem):
    pass


class VisibleSubjectNode(BaseModel):
    id: int
    code: str
    name: str
    level: int
    path: str
    children: list["VisibleSubjectNode"] = Field(default_factory=list)


class VisibleKnowledgeSubject(BaseModel):
    id: int
    code: str
    name: str
    level: int
    path: str
    knowledge_point_count: int
    edge_count: int


class VisibleKnowledgeNode(BaseModel):
    id: int
    name: str
    aliases: list[str] = Field(default_factory=list)
    description: str | None = None
    difficulty_level: int
    subject_id: int
    question_count: int
    in_degree: int
    out_degree: int
    degree: int
    relation_counts: dict[str, int] = Field(default_factory=dict)
    is_chapter_root: bool | None = None
    chapter_id: int | None = None
    chapter_order: int | None = None


class VisibleKnowledgeEdge(BaseModel):
    id: int
    source: int
    target: int
    relation_type: Literal["prerequisite", "parent", "related", "next"]
    weight: float


class VisibleKnowledgeSummary(BaseModel):
    total_nodes: int
    total_edges: int
    visible_nodes: int
    visible_edges: int
    isolated_nodes: int
    relation_counts: dict[str, int] = Field(default_factory=dict)


class VisibleKnowledgeTopic(BaseModel):
    id: int
    name: str
    direct_child_count: int
    question_count: int


class VisibleKnowledgeHotNode(BaseModel):
    id: int
    name: str
    degree: int


class VisibleKnowledgeGraphResponse(BaseModel):
    subject: dict[str, Any]
    summary: VisibleKnowledgeSummary
    nodes: list[VisibleKnowledgeNode]
    edges: list[VisibleKnowledgeEdge]
    hot_nodes: list[VisibleKnowledgeHotNode]
    overview_topics: list[VisibleKnowledgeTopic]
    focus_id: int | None = None
