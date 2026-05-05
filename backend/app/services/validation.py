from __future__ import annotations

from collections import Counter

from backend.app.models.schemas import Statement, ValidationIssue, ValidationReport


class FinancialValidator:
    def validate(self, statements: list[Statement]) -> ValidationReport:
        issues: list[ValidationIssue] = []
        for statement in statements:
            issues.extend(self._validate_statement(statement))
        summary = Counter(issue.severity for issue in issues)
        return ValidationReport(
            issues=issues,
            summary={"high": summary["high"], "medium": summary["medium"], "low": summary["low"]},
        )

    def _validate_statement(self, statement: Statement) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        seen_labels: set[str] = set()
        for row in statement.rows:
            normalized = row.label.strip().lower()
            if row.confidence < 0.75:
                issues.append(
                    ValidationIssue(
                        code="low_confidence",
                        severity="medium",
                        row_id=row.id,
                        statement_id=statement.id,
                        message=f"Review '{row.label}' because OCR confidence is {row.confidence:.0%}.",
                    )
                )
            if normalized in seen_labels and row.row_type != "header":
                issues.append(
                    ValidationIssue(
                        code="duplicate_line",
                        severity="low",
                        row_id=row.id,
                        statement_id=statement.id,
                        message=f"'{row.label}' appears more than once.",
                    )
                )
            seen_labels.add(normalized)
            if row.row_type != "header" and row.amount is None:
                issues.append(
                    ValidationIssue(
                        code="missing_amount",
                        severity="high",
                        row_id=row.id,
                        statement_id=statement.id,
                        message=f"'{row.label}' is missing an amount.",
                    )
                )
        issues.extend(self._validate_totals(statement))
        return issues

    def _validate_totals(self, statement: Statement) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        total_rows = [row for row in statement.rows if row.row_type == "total" and row.amount is not None]
        line_total = sum(row.amount or 0 for row in statement.rows if row.row_type in {"line_item", "subtotal"})
        for total in total_rows:
            if abs(line_total) > 0 and abs(abs(total.amount or 0) - abs(line_total)) / max(abs(line_total), 1) > 0.35:
                issues.append(
                    ValidationIssue(
                        code="suspicious_total",
                        severity="medium",
                        row_id=total.id,
                        statement_id=statement.id,
                        message=f"'{total.label}' does not reconcile closely with nearby extracted rows.",
                    )
                )
        if not total_rows:
            issues.append(
                ValidationIssue(
                    code="missing_total",
                    severity="low",
                    statement_id=statement.id,
                    message=f"{statement.statement_type.value} has no detected total row.",
                )
            )
        return issues
