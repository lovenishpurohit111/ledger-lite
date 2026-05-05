from __future__ import annotations

from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class StatementType(str, Enum):
    profit_and_loss = "Profit & Loss"
    balance_sheet = "Balance Sheet"
    cash_flow = "Cash Flow"


class PipelineStep(BaseModel):
    name: str
    status: str = "completed"
    detail: str = ""


class ExtractedRow(BaseModel):
    id: str
    label: str
    amount: float | None = None
    level: int = 0
    section: str = "Unclassified"
    row_type: str = "line_item"
    confidence: float = Field(default=0.75, ge=0, le=1)
    source_page: int | None = None
    issues: list[str] = Field(default_factory=list)
    raw_text: str | None = None


class Statement(BaseModel):
    id: str
    statement_type: StatementType
    title: str
    period: str | None = None
    rows: list[ExtractedRow]
    confidence: float = Field(default=0.75, ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ValidationIssue(BaseModel):
    code: str
    severity: str
    message: str
    row_id: str | None = None
    statement_id: str | None = None


class ValidationReport(BaseModel):
    issues: list[ValidationIssue] = Field(default_factory=list)
    summary: dict[str, int] = Field(default_factory=lambda: {"high": 0, "medium": 0, "low": 0})


class JobResult(BaseModel):
    job_id: str
    status: str
    message: str
    workbook_url: str | None = None
    statements: list[Statement]
    validation: ValidationReport
    pipeline: list[PipelineStep]


class ExportRequest(BaseModel):
    statements: list[Statement]


class OCRToken(BaseModel):
    text: str
    confidence: float
    page: int
    bbox: list[float] = Field(default_factory=list)
    kind: str = "text"


class OCRPage(BaseModel):
    page_number: int
    width: int | None = None
    height: int | None = None
    tokens: list[OCRToken] = Field(default_factory=list)
    text: str = ""
    layout: dict[str, Any] = Field(default_factory=dict)


class OCRDocument(BaseModel):
    pages: list[OCRPage]
    source_files: list[str]
