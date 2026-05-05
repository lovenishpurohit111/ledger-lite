from pathlib import Path
import uuid

from backend.app.models.schemas import ExtractedRow, Statement, StatementType
from backend.app.services.excel import ExcelWorkbookBuilder
from backend.app.services.validation import FinancialValidator


def test_validator_flags_low_confidence_rows():
    statement = Statement(
        id=str(uuid.uuid4()),
        statement_type=StatementType.profit_and_loss,
        title="Profit and Loss",
        rows=[
            ExtractedRow(id=str(uuid.uuid4()), label="Revenue", amount=100, confidence=0.6),
            ExtractedRow(id=str(uuid.uuid4()), label="Net Income", amount=100, row_type="total", confidence=0.9),
        ],
    )

    report = FinancialValidator().validate([statement])

    assert any(issue.code == "low_confidence" for issue in report.issues)
    assert report.summary["medium"] >= 1


def test_excel_builder_creates_three_statement_sheets(tmp_path: Path):
    statement = Statement(
        id=str(uuid.uuid4()),
        statement_type=StatementType.profit_and_loss,
        title="Profit and Loss",
        rows=[
            ExtractedRow(id=str(uuid.uuid4()), label="Revenue", amount=100, section="Revenue", confidence=0.95),
            ExtractedRow(id=str(uuid.uuid4()), label="Net Income", amount=100, section="Net Income", row_type="total", confidence=0.95),
        ],
    )
    output = tmp_path / "financials.xlsx"

    ExcelWorkbookBuilder().build([statement], output)

    assert output.exists()
    assert output.stat().st_size > 0
