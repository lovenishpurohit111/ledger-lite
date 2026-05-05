from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from backend.app.models.schemas import ExportRequest
from backend.app.services.pipeline import ConversionPipeline


APP_ROOT = Path(__file__).resolve().parents[1]
STORAGE_ROOT = APP_ROOT / "storage"
pipeline = ConversionPipeline(STORAGE_ROOT)

app = FastAPI(
    title="Financials Conversion API",
    version="1.0.0",
    description="Hybrid OCR, Gemini, validation, and Excel generation API for financial statement scans.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, object]:
    return {"ok": True, "app": "Financials Conversion", "ai": "Gemini", "claude": False}


@app.post("/api/jobs")
async def create_job(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=400, detail="Upload at least one JPG, PNG, or scanned PDF.")
    for upload in files:
        name = (upload.filename or "").lower()
        content_type = (upload.content_type or "").lower()
        if not (name.endswith((".jpg", ".jpeg", ".png", ".pdf", ".txt")) or content_type in {"image/jpeg", "image/png", "application/pdf", "text/plain"}):
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {upload.filename}")
    return await pipeline.run(files)


@app.post("/api/jobs/{job_id}/export")
def export_job(job_id: str, request: ExportRequest):
    workbook_path, validation = pipeline.export_reviewed(job_id, request.statements)
    return {"workbook_url": f"/api/jobs/{job_id}/download", "validation": validation, "path": str(workbook_path)}


@app.get("/api/jobs/{job_id}/download")
def download_job(job_id: str):
    workbook_path = pipeline.workbook_path(job_id)
    if not workbook_path.exists():
        raise HTTPException(status_code=404, detail="Workbook not found.")
    return FileResponse(
        workbook_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="financials-conversion.xlsx",
    )
