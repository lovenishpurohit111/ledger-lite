from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import UploadFile

from backend.app.models.schemas import JobResult, PipelineStep, Statement
from backend.app.services.excel import ExcelWorkbookBuilder
from backend.app.services.gemini import GeminiFinancialInterpreter
from backend.app.services.ocr import OCRService
from backend.app.services.preprocessing import PreprocessingService
from backend.app.services.validation import FinancialValidator


class ConversionPipeline:
    def __init__(self, storage_root: Path) -> None:
        self.storage_root = storage_root
        self.preprocessing = PreprocessingService()
        self.ocr = OCRService()
        self.interpreter = GeminiFinancialInterpreter()
        self.validator = FinancialValidator()
        self.excel = ExcelWorkbookBuilder()

    async def run(self, uploads: list[UploadFile]) -> JobResult:
        job_id = str(uuid.uuid4())
        job_dir = self.storage_root / job_id
        raw_dir = job_dir / "raw"
        processed_dir = job_dir / "processed"
        raw_dir.mkdir(parents=True, exist_ok=True)

        saved = []
        for upload in uploads:
            destination = raw_dir / self._clean_name(upload.filename or f"upload-{len(saved) + 1}")
            with destination.open("wb") as file:
                shutil.copyfileobj(upload.file, file)
            saved.append(destination)

        pipeline = [
            PipelineStep(name="Upload", detail=f"{len(saved)} files stored"),
            PipelineStep(name="Image preprocessing", detail="Deskew, denoise, sharpen, contrast, page boundary correction"),
        ]
        pages = self.preprocessing.preprocess_files(saved, processed_dir)
        pipeline.append(PipelineStep(name="OCR and table extraction", detail="Local OCR with token coordinates and numeric classification"))
        ocr_document = self.ocr.extract(pages)
        pipeline.append(PipelineStep(name="Gemini reconstruction", detail="Financial classification, hierarchy repair, terminology normalization"))
        statements = self.interpreter.reconstruct(ocr_document)
        pipeline.append(PipelineStep(name="Validation", detail="Totals, duplicates, missing values, and low-confidence rows"))
        validation = self.validator.validate(statements)
        workbook_path = job_dir / "financials-conversion.xlsx"
        self.excel.build(statements, workbook_path)
        pipeline.append(PipelineStep(name="Excel generation", detail="Formatted workbook with three professional sheets"))
        return JobResult(
            job_id=job_id,
            status="review",
            message="Conversion complete. Review highlighted rows before export.",
            workbook_url=f"/api/jobs/{job_id}/download",
            statements=statements,
            validation=validation,
            pipeline=pipeline,
        )

    def export_reviewed(self, job_id: str, statements: list[Statement]) -> tuple[Path, object]:
        job_dir = self.storage_root / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        validation = self.validator.validate(statements)
        workbook_path = job_dir / "financials-conversion-reviewed.xlsx"
        self.excel.build(statements, workbook_path)
        return workbook_path, validation

    def workbook_path(self, job_id: str) -> Path:
        reviewed = self.storage_root / job_id / "financials-conversion-reviewed.xlsx"
        if reviewed.exists():
            return reviewed
        return self.storage_root / job_id / "financials-conversion.xlsx"

    def _clean_name(self, name: str) -> str:
        keep = [char if char.isalnum() or char in "._-" else "_" for char in name]
        return "".join(keep)[:120]
