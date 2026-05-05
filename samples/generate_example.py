from pathlib import Path
import uuid
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))
from backend.app.models.schemas import ExtractedRow, Statement, StatementType
from backend.app.services.excel import ExcelWorkbookBuilder


def row(label, amount, section, row_type="line_item", level=1):
    return ExtractedRow(
        id=str(uuid.uuid4()),
        label=label,
        amount=amount,
        section=section,
        row_type=row_type,
        level=level,
        confidence=0.94,
    )


statements = [
    Statement(
        id=str(uuid.uuid4()),
        statement_type=StatementType.profit_and_loss,
        title="Profit & Loss Statement",
        period="For the year ended 2025",
        rows=[
            row("Revenue", 125000, "Revenue"),
            row("Cost of Goods Sold", 42000, "Cost of Sales"),
            row("Gross Profit", 83000, "Gross Profit", "subtotal", 0),
            row("Operating Expenses", 31000, "Operating Expenses"),
            row("Net Income", 52000, "Net Income", "total", 0),
        ],
    ),
    Statement(
        id=str(uuid.uuid4()),
        statement_type=StatementType.balance_sheet,
        title="Balance Sheet",
        period="As of December 31 2025",
        rows=[
            row("Cash and Cash Equivalents", 76000, "Assets"),
            row("Accounts Receivable", 28000, "Assets"),
            row("Total Assets", 104000, "Assets", "total", 0),
            row("Accounts Payable", 19000, "Liabilities"),
            row("Owner Equity", 85000, "Equity"),
            row("Total Liabilities and Equity", 104000, "Liabilities and Equity", "total", 0),
        ],
    ),
    Statement(
        id=str(uuid.uuid4()),
        statement_type=StatementType.cash_flow,
        title="Cash Flow Statement",
        period="For the year ended 2025",
        rows=[
            row("Cash from Operating Activities", 46000, "Operating Activities", "subtotal", 0),
            row("Cash from Investing Activities", -12000, "Investing Activities", "subtotal", 0),
            row("Cash from Financing Activities", 6000, "Financing Activities", "subtotal", 0),
            row("Net Change in Cash", 40000, "Net Cash Flow", "total", 0),
        ],
    ),
]

output = Path(__file__).resolve().parent / "output" / "financials-conversion-example.xlsx"
output.parent.mkdir(parents=True, exist_ok=True)
ExcelWorkbookBuilder().build(statements, output)
print(output)
