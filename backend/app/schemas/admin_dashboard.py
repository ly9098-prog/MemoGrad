from datetime import date

from app.schemas.base import BaseModel


class AdminDashboardOverview(BaseModel):
    users_total: int
    users_new_today: int
    questions_total: int
    questions_pending_review: int
    imports_total: int
    imports_pending: int
    audit_critical_today: int
    cache: dict


class AdminDashboardDailyPoint(BaseModel):
    date: date
    users_new: int
    questions_new: int
    imports_new: int
    audits_total: int


class AdminDashboardDistributionItem(BaseModel):
    name: str
    count: int


class AdminDashboardQuestionStats(BaseModel):
    by_subject: list[AdminDashboardDistributionItem]
    by_review_status: list[AdminDashboardDistributionItem]
    by_difficulty: list[AdminDashboardDistributionItem]
