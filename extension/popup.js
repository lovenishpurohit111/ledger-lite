// popup.js
"use strict";

const app = document.getElementById("app");

function render(html) { app.innerHTML = html; }

function renderNotSupported() {
  render(`
    <div class="not-supported">
      <div class="icon">📊</div>
      <p>Open a company page on<br>
        <a href="https://www.screener.in" target="_blank">screener.in</a>
        to export its financials to Excel.
      </p>
    </div>
  `);
}

function renderMain(meta, statements) {
  const STMT_LIST = [
    { id: "profit-loss",   label: "Profit & Loss"  },
    { id: "balance-sheet", label: "Balance Sheet"  },
    { id: "cash-flow",     label: "Cash Flow"      },
    { id: "quarters",      label: "Quarterly"      },
  ];

  const foundCount = STMT_LIST.filter(s => statements[s.id]).length;

  const stmtRows = STMT_LIST.map(s => {
    const data = statements[s.id];
    const found = !!data;
    const rowCount = data ? data.rows.length : 0;
    return `
      <div class="stmt-row ${found ? "found" : "missing"}">
        <div class="dot ${found ? "found" : ""}"></div>
        <span class="stmt-name">${s.label}</span>
        ${found ? `<span class="stmt-rows">${rowCount} rows</span>` : ""}
      </div>`;
  }).join("");

  render(`
    <div class="company-card">
      <div class="company-name">${escHtml(meta.name)}</div>
      ${meta.ticker ? `<div class="company-ticker">${escHtml(meta.ticker)}</div>` : ""}
    </div>

    <div class="section-label">Statements detected</div>
    <div class="statements">${stmtRows}</div>

    <div class="section-label">Options</div>
    <div class="options">
      <label class="opt-row">
        <input type="checkbox" id="opt-growth" checked />
        Add YoY growth % rows
      </label>
      <label class="opt-row">
        <input type="checkbox" id="opt-quarterly" />
        Include quarterly data
      </label>
    </div>

    <button class="btn-export" id="btn-export" ${foundCount === 0 ? "disabled" : ""}>
      ⬇ Export ${foundCount} sheet${foundCount !== 1 ? "s" : ""} to Excel
    </button>
    <div class="status" id="status"></div>
  `);

  document.getElementById("btn-export")?.addEventListener("click", () => {
    const includeQuarterly = document.getElementById("opt-quarterly")?.checked;

    // Filter statements based on options
    const filtered = { ...statements };
    if (!includeQuarterly) delete filtered.quarters;

    doExport(meta, filtered);
  });
}

function doExport(meta, statements) {
  const btn = document.getElementById("btn-export");
  const status = document.getElementById("status");

  btn.disabled = true;
  btn.textContent = "Exporting…";
  status.className = "status loading";
  status.textContent = "Building workbook…";

  try {
    exportToExcel(meta, statements);
    status.className = "status success";
    status.textContent = "✅ Downloaded successfully!";
    btn.textContent = "⬇ Export again";
  } catch (err) {
    status.className = "status error";
    status.textContent = "❌ " + err.message;
    btn.textContent = "⬇ Export to Excel";
  } finally {
    btn.disabled = false;
  }
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    renderNotSupported(); return;
  }

  const url = tab?.url || "";
  const onScreener = /screener\.in\/company\//i.test(url);

  if (!onScreener) { renderNotSupported(); return; }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "extractData" });

    if (!response?.ok) throw new Error("Content script did not respond.");

    const { meta, statements } = response;
    const foundAny = Object.keys(statements).length > 0;

    if (!foundAny) {
      render(`
        <div class="not-supported">
          <div class="icon">⚠️</div>
          <p>No financial tables found.<br>Try reloading the page.</p>
        </div>
      `);
      return;
    }

    renderMain(meta, statements);
  } catch (err) {
    // Content script not yet injected — try programmatic injection
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      // Small delay then retry
      await new Promise(r => setTimeout(r, 300));
      const response2 = await chrome.tabs.sendMessage(tab.id, { action: "extractData" });
      if (response2?.ok) { renderMain(response2.meta, response2.statements); return; }
    } catch {}

    render(`
      <div class="not-supported">
        <div class="icon">⚠️</div>
        <p>Could not read the page.<br>
           Please <strong>reload the tab</strong> and try again.</p>
      </div>
    `);
  }
}

init();
