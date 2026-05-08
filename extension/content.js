// content.js — injected into screener.in/company/* pages
// Reads tables directly from the DOM — 100% accurate, no OCR needed.

(function () {
  "use strict";

  // ── Screener.in section IDs → statement names ─────────────────────────────
  const SECTIONS = [
    { id: "profit-loss",    name: "Profit & Loss"  },
    { id: "balance-sheet",  name: "Balance Sheet"  },
    { id: "cash-flow",      name: "Cash Flow"      },
    { id: "quarters",       name: "Quarterly"      },
  ];

  // ── Extract one table section ─────────────────────────────────────────────
  function extractSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return null;

    const table = section.querySelector("table");
    if (!table) return null;

    // Header row — year columns
    const headerCells = table.querySelectorAll("thead tr th, thead tr td");
    const headers = [...headerCells].map(th => th.textContent.trim()).filter(Boolean);
    if (headers.length < 2) return null;

    // Data rows
    const rows = [];
    table.querySelectorAll("tbody tr").forEach(tr => {
      const cells = [...tr.querySelectorAll("td, th")];
      if (!cells.length) return;
      const values = cells.map(td => td.textContent.trim());
      if (values.every(v => !v)) return;       // skip empty rows
      rows.push(values);
    });

    // Unit line (e.g. "Consolidated Figures in Rs. Crores")
    const unitEl = section.querySelector(".sub, .note, [class*='sub']");
    const unit = unitEl ? unitEl.textContent.trim() : null;

    return { headers, rows, unit };
  }

  // ── Company metadata ──────────────────────────────────────────────────────
  function getMeta() {
    const name = (
      document.querySelector(".company-header h1") ||
      document.querySelector("h1.margin-0") ||
      document.querySelector("h1")
    )?.textContent?.trim() || "Company";

    const bse  = document.querySelector("[data-field='bse_code']")?.textContent?.trim();
    const nse  = document.querySelector("[data-field='nse_code']")?.textContent?.trim();
    const ticker = nse || bse || "";

    return { name, ticker };
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== "extractData") return;

    const meta = getMeta();
    const statements = {};

    for (const { id, name } of SECTIONS) {
      const data = extractSection(id);
      if (data && data.rows.length > 0) statements[id] = { ...data, name };
    }

    sendResponse({ ok: true, meta, statements });
    return true; // keep channel open for async
  });
})();
