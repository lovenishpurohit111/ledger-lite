// content.js — works on Screener.in, Tickertape, Moneycontrol, and any financial site
"use strict";

(function () {

  const HOST = window.location.hostname;
  const SITE =
    HOST.includes("screener.in")      ? "screener"     :
    HOST.includes("tickertape.in")    ? "tickertape"   :
    HOST.includes("moneycontrol.com") ? "moneycontrol" : "generic";

  // Matches any period header: "Mar 2024", "FY24", "Q4 FY24", "TTM", "2024"
  const PERIOD_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*[''`]?\s*\d{2,4}\b|\bFY\s*\d{2,4}\b|\bQ[1-4]\s*(?:FY)?\s*\d{2,4}\b|\b(TTM|LTM)\b|\b20\d{2}\b|\b\d+\s*mths?\b|\b\d+\s*months?\b/i;

  const STMT_PATTERNS = [
    { re: /profit\s*[&and]+\s*loss|income\s*statement|p\s*[&]\s*l/i, name: "Profit & Loss"  },
    { re: /balance\s*sheet|financial\s*position/i,                    name: "Balance Sheet"  },
    { re: /cash\s*flow/i,                                             name: "Cash Flow"      },
    { re: /quarter(ly)?/i,                                            name: "Quarterly"      },
  ];

  function detectStmtType(el) {
    // Check inside the table first (e.g. Moneycontrol puts title in first <th>)
    if (el && el.querySelectorAll) {
      const firstCell = el.querySelector("th,caption");
      if (firstCell) {
        for (const { re, name } of STMT_PATTERNS) if (re.test(firstCell.textContent)) return name;
      }
    }
    // Walk upward to find headings
    let cur = el;
    for (let i = 0; i < 8; i++) {
      cur = cur.previousElementSibling || cur.parentElement;
      if (!cur) break;
      const nodes = cur.matches && cur.matches("h1,h2,h3,h4,h5,h6,caption") ? [cur] : [];
      if (cur.querySelectorAll) nodes.push(...cur.querySelectorAll("h1,h2,h3,h4,h5,h6,caption,th"));
      for (const h of nodes) {
        const t = h.textContent.trim();
        for (const { re, name } of STMT_PATTERNS) if (re.test(t)) return name;
      }
    }
    // Last resort: check the page title
    const title = (typeof document !== "undefined" ? document.title : "").toLowerCase();
    for (const { re, name } of STMT_PATTERNS) if (re.test(title)) return name;
    return "Financial Statement";
  }

  // ── Universal table finder — no site-specific CSS needed ──────────────────
  function findFinancialTables() {
    const out = [];
    for (const table of document.querySelectorAll("table")) {
      const headerCells = [...table.querySelectorAll("thead tr th,thead tr td,tr:first-child th,tr:first-child td")];
      const periodCount = headerCells.filter(c => PERIOD_RE.test(c.textContent)).length;
      if (periodCount >= 2 && table.querySelectorAll("tbody tr, tr").length >= 3) out.push(table);
    }
    return out;
  }

  function extractTable(table) {
    const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
    if (!headerRow) return null;
    const headers = [...headerRow.querySelectorAll("th,td")].map(c => c.textContent.trim());
    if (headers.filter(h => PERIOD_RE.test(h)).length < 2) return null;

    const rows = [...table.querySelectorAll("tbody tr, tr")]
      .filter(r => r !== headerRow)
      .map(tr => [...tr.querySelectorAll("td,th")].map((c, i) => {
        let text = c.textContent.replace(/\s+/g, " ").trim();
        // Strip trailing "+" expand buttons (Screener.in) from label column only
        if (i === 0) text = text.replace(/\s*\+\s*$/, "").trim();
        return text;
      }))
      .filter(r => r.some(c => c));

    // Nearby unit label — walk up through section too for Screener.in
    let unit = null;
    const containers = [table.closest("section"), table.closest("div"), table.parentElement].filter(Boolean);
    for (const wrap of containers) {
      const candidates = [...wrap.querySelectorAll("p,span,small,caption,div")]
        .filter(e => !e.querySelector("table"))
        .map(e => e.textContent.trim().replace(/\s*\/\s*View Standalone.*/i, "").trim())
        .filter(t => /crore|lakh|million|rs\.?/i.test(t) && t.length < 80);
      if (candidates.length) { unit = candidates[0]; break; }
    }

    return rows.length ? { headers, rows, unit } : null;
  }

  // ── Tickertape __NEXT_DATA__ shortcut ─────────────────────────────────────
  function tryNextData() {
    try {
      const script = document.getElementById("__NEXT_DATA__");
      if (!script) return null;
      const nd = JSON.parse(script.textContent);
      const fin = nd?.props?.pageProps?.financials
               || nd?.props?.pageProps?.securityFinancials
               || nd?.props?.pageProps?.data?.financials;
      if (!fin) return null;

      const stmts = {};
      const MAP = [["income","Profit & Loss"],["balanceSheet","Balance Sheet"],["cashFlow","Cash Flow"]];
      for (const [key, name] of MAP) {
        const raw = fin[key];
        if (!raw?.headers || !raw?.rows) continue;
        stmts[key] = {
          name, unit: fin.unit || "Rs. Crores",
          headers: ["", ...raw.headers],
          rows: raw.rows.map(r => [r.label, ...(r.values || []).map(v => v ?? "")])
        };
      }
      return Object.keys(stmts).length ? stmts : null;
    } catch { return null; }
  }

  // ── Company metadata ──────────────────────────────────────────────────────
  function getMeta() {
    const SEL = {
      screener:     "h1.margin-0, .company-header h1",
      tickertape:   "h1[class*='name'], h1[class*='title'], h1",
      moneycontrol: ".pcstname, #stockName, h1",
      generic:      "h1",
    };
    const name = document.querySelector(SEL[SITE] || "h1")?.textContent?.trim()
               || document.title.split(/[-|]/)[0].trim()
               || "Company";
    const tickerEl = document.querySelector("[data-field='nse_code'],[data-field='bse_code'],[class*='ticker'],[class*='symbol']");
    return { name, ticker: tickerEl?.textContent?.trim() || "" };
  }

  // ── Main extract ──────────────────────────────────────────────────────────
  function extract() {
    const meta = getMeta();

    // Tickertape: try JSON first
    if (SITE === "tickertape") {
      const nd = tryNextData();
      if (nd) return { ok: true, meta, statements: nd };
    }

    // Screener: use known IDs
    if (SITE === "screener") {
      const SECS = [
        ["profit-loss","Profit & Loss"], ["balance-sheet","Balance Sheet"],
        ["cash-flow","Cash Flow"],       ["quarters","Quarterly"]
      ];
      const stmts = {};
      for (const [id, name] of SECS) {
        const section = document.getElementById(id);
        const table   = section?.querySelector("table");
        if (!table) continue;
        const data = extractTable(table);
        if (data?.rows.length) stmts[id] = { ...data, name };
      }
      if (Object.keys(stmts).length) return { ok: true, meta, statements: stmts };
    }

    // Universal fallback (Moneycontrol, Tickertape DOM, etc.)
    const stmts = {};
    const seen  = new Set();
    for (const table of findFinancialTables()) {
      const data = extractTable(table);
      if (!data) continue;
      const name = detectStmtType(table);
      if (seen.has(name)) continue;
      seen.add(name);
      stmts[name.toLowerCase().replace(/[^a-z]/g,"-")] = { ...data, name };
    }

    return { ok: Object.keys(stmts).length > 0, meta, statements: stmts };
  }

  // ── Listen for popup messages — retry for SPA pages ───────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== "extractData") return;
    let tries = 0;
    function attempt() {
      const r = extract();
      if (r.ok || tries++ >= 6) sendResponse(r);
      else setTimeout(attempt, 500);
    }
    attempt();
    return true;
  });

})();
