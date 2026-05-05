from __future__ import annotations

import json
import os
import re
import uuid

from backend.app.models.schemas import OCRDocument, Statement, StatementType, ExtractedRow


class GeminiFinancialInterpreter:
    def reconstruct(self, document: OCRDocument) -> list[Statement]:
        payload = self._compact_payload(document)
        gemini_result = self._call_gemini(payload)
        if gemini_result:
            return gemini_result
        return self._heuristic_reconstruction(document)

    def _call_gemini(self, payload: dict[str, object]) -> list[Statement] | None:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not api_key:
            return None
        try:
            from google import genai
        except Exception:
            return None

        prompt = (
            "You are a financial statement reconstruction engine. Use the OCR tokens and layout metadata to return JSON only. "
            "Classify each statement as Profit & Loss, Balance Sheet, or Cash Flow. Rebuild rows with label, amount, section, "
            "level, row_type, confidence, and issues. Preserve hierarchy and flag uncertainty. Do not invent values."
        )
        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
                contents=[prompt, json.dumps(payload)],
            )
            text = getattr(response, "text", "") or ""
            parsed = json.loads(self._json_only(text))
            return [Statement.model_validate(statement) for statement in parsed.get("statements", [])]
        except Exception:
            return None

    def _compact_payload(self, document: OCRDocument) -> dict[str, object]:
        return {
            "source_files": document.source_files,
            "pages": [
                {
                    "page_number": page.page_number,
                    "text": page.text[:6000],
                    "layout": page.layout,
                    "tokens": [token.model_dump() for token in page.tokens[:800]],
                }
                for page in document.pages
            ],
        }

    def _heuristic_reconstruction(self, document: OCRDocument) -> list[Statement]:
        text = "\n".join(page.text for page in document.pages)
        statement_type = self._classify(text)
        rows = self._rows_from_text(text, statement_type)
        if not rows:
            rows = self._sample_rows(statement_type)
        return [
            Statement(
                id=str(uuid.uuid4()),
                statement_type=statement_type,
                title=f"{statement_type.value} Statement",
                period=self._period(text),
                rows=rows,
                confidence=round(sum(row.confidence for row in rows) / max(len(rows), 1), 3),
                metadata={"interpreter": "heuristic-fallback", "gemini_configured": False},
            )
        ]

    def _classify(self, text: str) -> StatementType:
        lower = text.lower()
        if "cash flow" in lower or "operating activities" in lower or "financing activities" in lower:
            return StatementType.cash_flow
        if "balance sheet" in lower or "assets" in lower and "liabilities" in lower:
            return StatementType.balance_sheet
        return StatementType.profit_and_loss

    def _rows_from_text(self, text: str, statement_type: StatementType) -> list[ExtractedRow]:
        pairs = re.findall(r"([A-Za-z][A-Za-z &/()'-]{2,}?)\s+(\(?-?[$₹€£]?\d[\d,]*(?:\.\d+)?\)?)", text)
        rows: list[ExtractedRow] = []
        current_section = self._default_section(statement_type)
        for label, amount_text in pairs[:80]:
            clean_label = " ".join(label.split())[-80:].strip(" -:")
            if len(clean_label) < 3:
                continue
            row_type = "total" if "total" in clean_label.lower() or "net " in clean_label.lower() else "line_item"
            if row_type == "total":
                current_section = clean_label
            rows.append(
                ExtractedRow(
                    id=str(uuid.uuid4()),
                    label=clean_label,
                    amount=self._number(amount_text),
                    level=0 if row_type == "total" else 1,
                    section=current_section,
                    row_type=row_type,
                    confidence=0.72 if row_type == "line_item" else 0.82,
                    issues=[] if row_type == "total" else ["Review OCR mapping before export"],
                    raw_text=f"{clean_label} {amount_text}",
                )
            )
        return rows

    def _sample_rows(self, statement_type: StatementType) -> list[ExtractedRow]:
        samples = {
            StatementType.profit_and_loss: [
                ("Revenue", 125000, "Revenue", "line_item"),
                ("Cost of Goods Sold", 42000, "Cost of Sales", "line_item"),
                ("Gross Profit", 83000, "Gross Profit", "subtotal"),
                ("Operating Expenses", 31000, "Operating Expenses", "line_item"),
                ("Net Income", 52000, "Net Income", "total"),
            ],
            StatementType.balance_sheet: [
                ("Cash and Cash Equivalents", 76000, "Assets", "line_item"),
                ("Accounts Receivable", 28000, "Assets", "line_item"),
                ("Total Assets", 104000, "Assets", "total"),
                ("Accounts Payable", 19000, "Liabilities", "line_item"),
                ("Owner Equity", 85000, "Equity", "line_item"),
                ("Total Liabilities and Equity", 104000, "Liabilities and Equity", "total"),
            ],
            StatementType.cash_flow: [
                ("Cash from Operating Activities", 46000, "Operating Activities", "subtotal"),
                ("Cash from Investing Activities", -12000, "Investing Activities", "subtotal"),
                ("Cash from Financing Activities", 6000, "Financing Activities", "subtotal"),
                ("Net Change in Cash", 40000, "Net Cash Flow", "total"),
            ],
        }
        return [
            ExtractedRow(
                id=str(uuid.uuid4()),
                label=label,
                amount=amount,
                level=0 if row_type in {"subtotal", "total"} else 1,
                section=section,
                row_type=row_type,
                confidence=0.86,
                issues=["Demo row generated because OCR dependencies or source text were unavailable"],
            )
            for label, amount, section, row_type in samples[statement_type]
        ]

    def _default_section(self, statement_type: StatementType) -> str:
        return {
            StatementType.profit_and_loss: "Income Statement",
            StatementType.balance_sheet: "Balance Sheet",
            StatementType.cash_flow: "Cash Flow",
        }[statement_type]

    def _period(self, text: str) -> str | None:
        match = re.search(r"(?:for|year|period|ended|as of)[^\n]{0,40}(\d{4})", text, re.IGNORECASE)
        return match.group(0).strip() if match else None

    def _number(self, value: str) -> float:
        clean = value.strip().replace(",", "").replace("$", "").replace("₹", "").replace("€", "").replace("£", "")
        negative = clean.startswith("(") and clean.endswith(")")
        clean = clean.strip("()")
        number = float(clean)
        return -number if negative else number

    def _json_only(self, value: str) -> str:
        fenced = re.search(r"```(?:json)?\s*(.*?)```", value, re.DOTALL)
        if fenced:
            return fenced.group(1)
        start = value.find("{")
        end = value.rfind("}")
        return value[start : end + 1]
