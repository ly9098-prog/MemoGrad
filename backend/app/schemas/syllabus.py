from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.base import BaseModel
from app.schemas.knowledge_outline import KnowledgeOutlineFields

SyllabusStatus = Literal["draft", "active", "archived"]
SyllabusMappingType = Literal[
    "unchanged", "renamed", "added", "removed", "merged", "split", "replaced"
]
SyllabusManualMappingType = Literal["merged", "split", "replaced"]


class SyllabusVersionCreate(BaseModel):
    code: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=2, max_length=128)
    effective_year: int = Field(ge=2000, le=2200)
    description: str | None = Field(default=None, max_length=2000)


class SyllabusVersionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=128)
    effective_year: int | None = Field(default=None, ge=2000, le=2200)
    description: str | None = Field(default=None, max_length=2000)


class SyllabusVersionSummary(BaseModel):
    id: int
    code: str
    name: str
    effective_year: int
    status: SyllabusStatus
    description: str | None = None
    knowledge_point_count: int = 0
    activated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SyllabusKnowledgePointItem(BaseModel):
    id: int
    knowledge_point_id: int
    subject_id: int
    subject_code: str
    subject_name: str
    name: str
    normalized_name: str
    description: str | None = None
    difficulty_level: int
    sort_order: int = 0


class SyllabusVersionDetail(SyllabusVersionSummary):
    knowledge_points: list[SyllabusKnowledgePointItem] = Field(default_factory=list)


class SyllabusMembershipReplace(BaseModel):
    knowledge_point_ids: list[int] = Field(default_factory=list, max_length=5000)


class SyllabusCatalogItem(KnowledgeOutlineFields):
    is_active: bool = True
    knowledge_point_id: int
    subject_id: int
    subject_code: str
    subject_name: str
    name: str
    description: str | None = None
    difficulty_level: int
    included: bool = False


class KnowledgeLabelCreate(BaseModel):
    subject_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=4000)
    difficulty_level: int = Field(default=3, ge=1, le=5)
    parent_knowledge_point_id: int | None = Field(default=None, gt=0)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("标签名称不能为空")
        return value


class KnowledgeLabelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=4000)
    difficulty_level: int | None = Field(default=None, ge=1, le=5)
    is_active: bool | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("标签名称不能为空")
        return value

    @model_validator(mode="after")
    def require_update(self):
        if not self.model_fields_set:
            raise ValueError("至少提供一个要更新的字段")
        for field in ("name", "difficulty_level", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 不能为 null")
        return self


class KnowledgeLabelResponse(BaseModel):
    id: int
    subject_id: int
    name: str
    description: str | None = None
    difficulty_level: int
    is_active: bool


class SyllabusCatalogResponse(BaseModel):
    syllabus_version_id: int
    items: list[SyllabusCatalogItem] = Field(default_factory=list)


class SyllabusMappingCreate(BaseModel):
    from_syllabus_knowledge_point_id: int | None = None
    to_syllabus_knowledge_point_id: int | None = None
    relation_type: SyllabusManualMappingType
    note: str | None = Field(default=None, max_length=256)


class SyllabusMappingItem(BaseModel):
    id: int
    from_syllabus_knowledge_point_id: int | None = None
    to_syllabus_knowledge_point_id: int | None = None
    relation_type: SyllabusMappingType
    note: str | None = None
    from_name: str | None = None
    to_name: str | None = None
    created_at: datetime


class SyllabusCoverageItem(BaseModel):
    syllabus_knowledge_point_id: int
    knowledge_point_id: int
    subject_id: int
    subject_code: str
    subject_name: str
    name: str
    question_count: int = 0
    covered: bool = False


class SyllabusCoverageResponse(BaseModel):
    syllabus_version_id: int
    syllabus_code: str
    total_knowledge_points: int = 0
    covered_knowledge_points: int = 0
    coverage_ratio: float = 0.0
    items: list[SyllabusCoverageItem] = Field(default_factory=list)


class ActiveSyllabusSummary(BaseModel):
    id: int
    code: str
    name: str
    effective_year: int
