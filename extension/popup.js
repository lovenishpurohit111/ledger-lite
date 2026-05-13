// popup.js
"use strict";

const app = document.getElementById("app");

function render(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  app.replaceChildren(...doc.body.childNodes);
}

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
  // Build display list from BOTH hardcoded expected + actually found keys
  const EXPECTED = [
    { id: "profit-loss",   label: "Profit & Loss" },
    { id: "balance-sheet", label: "Balance Sheet" },
    { id: "cash-flow",     label: "Cash Flow"     },
    { id: "quarters",      label: "Quarterly"     },
  ];

  // Merge: show expected slots + any extra keys found by universal detector
  const allKeys = [...new Set([...EXPECTED.map(e=>e.id), ...Object.keys(statements)])];
  const STMT_LIST = allKeys.map(id => {
    const expected = EXPECTED.find(e => e.id === id);
    const data = statements[id];
    return { id, label: expected?.label || data?.name || id, data };
  });

  const foundCount = STMT_LIST.filter(s => s.data).length;

  const stmtRows = STMT_LIST.map(s => {
    const found = !!s.data;
    const rowCount = s.data?.rows?.length || 0;
    return `
      <div class="stmt-row ${found ? "found" : "missing"}">
        <div class="dot ${found ? "found" : ""}"></div>
        <span class="stmt-name">${escHtml(s.label)}</span>
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

    // Filter out quarterly unless opted in
    const filtered = Object.fromEntries(
      Object.entries(statements).filter(([k, v]) =>
        includeQuarterly || !(k === "quarters" || (v?.name||"").toLowerCase().includes("quarter"))
      )
    );

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
    const addGrowth = document.getElementById("opt-growth")?.checked ?? true;
    exportToExcel(meta, statements, addGrowth);
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
  // ── PDF support (check BEFORE site filter)
  if (url.toLowerCase().endsWith(".pdf") || url.includes(".pdf?") || url.includes("/pdf")) {
    const filename = url.split("/").pop().split("?")[0];
    // Load saved API key
    const saved = await chrome.storage.local.get("geminiKey");
    const savedKey = saved.geminiKey || "";

    render(`
      <div class="company-card" style="margin-bottom:12px">
        <div class="company-name">PDF Detected</div>
        <div class="company-ticker" style="word-break:break-all;font-size:10px">${escHtml(filename)}</div>
      </div>
      <div style="margin-bottom:10px">
        <div class="section-label" style="margin-bottom:4px">Gemini API Key <span style="color:#22c55e;font-weight:400">(optional — better accuracy)</span></div>
        <input id="gemini-key" type="password" placeholder="AIza... (leave blank to use text extraction)"
          value="${escHtml(savedKey)}"
          style="width:100%;border:1px solid #e2e8f0;border-radius:7px;padding:6px 10px;font-size:12px;outline:none"/>
      </div>
      <div class="status loading" id="page-status" style="display:block;margin-bottom:10px">Loading PDF info...</div>
      <div id="range-ui" style="display:none">
        <div class="section-label" style="margin-bottom:6px">Select page range</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="flex:1">
            <div style="font-size:11px;color:#64748b;margin-bottom:3px">From page</div>
            <input id="pg-from" type="number" min="1" value="1" style="width:100%;border:1px solid #e2e8f0;border-radius:7px;padding:6px 8px;font-size:13px"/>
          </div>
          <div style="padding-top:16px;color:#94a3b8">to</div>
          <div style="flex:1">
            <div style="font-size:11px;color:#64748b;margin-bottom:3px">To page</div>
            <input id="pg-to" type="number" min="1" value="1" style="width:100%;border:1px solid #e2e8f0;border-radius:7px;padding:6px 8px;font-size:13px"/>
          </div>
          <div style="padding-top:16px">
            <div style="font-size:11px;color:#64748b;margin-bottom:3px">Total</div>
            <div id="pg-total" style="font-size:13px;font-weight:700;color:#0f172a">?</div>
          </div>
        </div>
        <p style="font-size:11px;color:#94a3b8;margin-bottom:10px;line-height:1.4">
          Tip: check the PDF table of contents for P&L / Balance Sheet page numbers.
        </p>
        <button class="btn-export" id="btn-pdf">Extract Pages</button>
      </div>
      <div class="status" id="status"></div>
    `);
    try {
      const total = await window.getPDFPageCount(url);
      document.getElementById("page-status").style.display = "none";
      document.getElementById("range-ui").style.display = "block";
      document.getElementById("pg-to").value = total;
      document.getElementById("pg-total").textContent = total;
      document.getElementById("pg-from").max = total;
      document.getElementById("pg-to").max = total;
    } catch {
      document.getElementById("page-status").className = "status error";
      document.getElementById("page-status").textContent = "Could not read PDF. Try downloading it first.";
    }
    document.getElementById("btn-pdf")?.addEventListener("click", async () => {
      const btn = document.getElementById("btn-pdf");
      const status = document.getElementById("status");
      const from = Math.max(1, parseInt(document.getElementById("pg-from").value)||1);
      const to = parseInt(document.getElementById("pg-to").value)||from;
      btn.disabled = true;
      btn.textContent = "Extracting pages " + from + " to " + to + "...";
      status.className = "status loading"; status.style.display = "block";
      status.textContent = "Reading " + (to-from+1) + " page(s)...";
      try {
        const geminiKey = document.getElementById("gemini-key")?.value?.trim() || "";
        if (geminiKey) { await chrome.storage.local.set({ geminiKey }); status.textContent = "Rendering pages for Gemini..."; }
        const result = await window.extractPDF(url, from, to, geminiKey, (msg) => {
          status.textContent = msg;
        });
        if (!result.ok) throw new Error("No financial tables found in pages " + from + "-" + to + ". Try a wider range.");
        renderMain(result.meta, result.statements, url);
      } catch (err) {
        status.className = "status error";
        let m = err.message || "Unknown error";
        if (m.includes("429")) m = "Gemini quota exceeded. Wait or use a different key.";
        else if (m.includes("400")) m = "Invalid Gemini API key. Check and retry.";
        else if (m.includes("403")) m = "Key lacks permission. Enable Gemini API in Google Cloud.";
        status.textContent = "❌ " + m;
        btn.disabled = false; btn.textContent = "Try again";
      }
    });
    return;
  }

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
