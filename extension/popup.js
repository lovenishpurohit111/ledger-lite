// popup.js
"use strict";

const app = document.getElementById("app");

function render(html) { app.innerHTML = html; }

function renderNotSupported() {
  render(`
    <div class="not-supported">
      <div class="icon">📊</div>
      <p>Open a company page on<br>
        <a href="https://www.screener.in" target="_blank">Screener.in</a>, <a href="https://www.tickertape.in" target="_blank">Tickertape</a> or <a href="https://www.moneycontrol.com" target="_blank">Moneycontrol</a> to export financials to Excel.
      </p>
    </div>
  `);
}

function renderMain(meta, statements, tab_url = "") {
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
      <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
        ${meta.ticker ? `<span class="company-ticker">${escHtml(meta.ticker)}</span>` : ""}
        <span style="font-size:10px;background:#e0f2fe;color:#0369a1;padding:1px 6px;border-radius:9px;font-weight:600">${escHtml(siteName(tab_url))}</span>
      </div>
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

function siteName(url) {
  if (!url) return "";
  if (url.includes("screener.in"))      return "Screener.in";
  if (url.includes("tickertape.in"))    return "Tickertape";
  if (url.includes("moneycontrol.com")) return "Moneycontrol";
  return "Web";
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
  const host = new URL(url).hostname;
  const onSupported = ["screener.in","tickertape.in","moneycontrol.com"].some(s => host.includes(s));

  if (!onSupported) { renderNotSupported(); return; }

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
      if (response2?.ok) { renderMain(response2.meta, response2.statements, tab.url); return; }
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
