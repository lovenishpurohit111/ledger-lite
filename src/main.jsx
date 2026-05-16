import React from "react";
import { processImages, exportToExcel } from "./processor.js";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  FileText,
  FolderUp,
  Loader2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wand2
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const emptyJob = {
  job_id: null,
  status: "idle",
  message: "Upload scanned financial statements to begin.",
  workbook_url: null,
  statements: [],
  validation: { issues: [], summary: { high: 0, medium: 0, low: 0 } },
  pipeline: []
};

function App() {
  const [files, setFiles] = React.useState([]);
  const [job, setJob] = React.useState(emptyJob);
  const [activeStatement, setActiveStatement] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const [pasteStatus, setPasteStatus] = React.useState("");
  const [checks, setChecks] = React.useState(defaultChecks());

  const currentStatement = job.statements[activeStatement] || job.statements[0];
  const overallConfidence = React.useMemo(() => {
    const rows = job.statements.flatMap((statement) => statement.rows || []);
    if (!rows.length) return 0;
    return Math.round((rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length) * 100);
  }, [job.statements]);

  const updateFiles = React.useCallback((nextFiles, source = "upload") => {
    const accepted = [...nextFiles].filter((file) => /image\/(png|jpeg|webp)|application\/pdf/.test(file.type) || /\.(jpe?g|png|webp|pdf)$/i.test(file.name));
    setFiles((current) => [...current, ...accepted]);
    setError(accepted.length ? "" : "Add JPG, PNG, or scanned PDF files.");
    if (accepted.length && source === "paste") {
      setPasteStatus(`${accepted.length} screenshot${accepted.length === 1 ? "" : "s"} pasted and ready to convert.`);
    }
  }, []);

  // Auto-check API health + Gemini status on page load
  React.useEffect(() => {
    async function checkOnLoad() {
      try {
        setChecks((current) => updateCheck(current, "health", checkRunning("Checking API...")));
        const health = await fetchJson("/api/health").catch(() => ({ ok: false }));
        setChecks((current) => updateCheck(current, "health", health.ok ? checkPass("API reachable.") : checkFail("API unreachable.")));

        setChecks((current) => updateCheck(current, "gemini", checkRunning("Testing Gemini key...")));
        const diagnostics = await fetchJson("/api/diagnostics").catch(() => ({ geminiConfigured: false, geminiStatus: "network" }));
        setChecks((current) => ({
          ...current,
          gemini: { ...current.gemini, ...(
            diagnostics.geminiConfigured
              ? checkPass(diagnostics.message || "Gemini API key is working.")
              : diagnostics.geminiStatus === "invalid_key"
                ? checkFail("Gemini key is invalid. Check Google Cloud Console.")
                : diagnostics.geminiStatus === "rate_limit"
                  ? checkWarn("Gemini key works but is currently rate-limited.")
                  : diagnostics.geminiStatus === "no_models_available"
                    ? checkFail("Gemini key present but no models accessible. Enable Gemini API in Google Cloud.")
                    : checkWarn("Gemini not configured — running in OCR-only mode.")
          ) },
        }));
      } catch { /* silent — don't block UI */ }
    }
    checkOnLoad();
  }, []);

  React.useEffect(() => {
    function handlePaste(event) {
      const pastedFiles = filesFromClipboardItems(event.clipboardData?.items);
      if (!pastedFiles.length) return;
      event.preventDefault();
      updateFiles(pastedFiles, "paste");
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [updateFiles]);

  async function pasteScreenshot() {
    setError("");
    setPasteStatus("");
    if (!navigator.clipboard?.read) {
      setError("Your browser does not expose direct clipboard image reads. Use Ctrl+V or Cmd+V after taking the screenshot.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      const imageFiles = [];
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        imageFiles.push(blobToFile(blob, `pasted-statement-${Date.now()}-${imageFiles.length + 1}.${extensionForType(imageType)}`));
      }
      if (!imageFiles.length) {
        setError("No screenshot image was found on the clipboard.");
        return;
      }
      updateFiles(imageFiles, "paste");
    } catch {
      setError("Clipboard access was blocked. Click the upload panel and press Ctrl+V or Cmd+V instead.");
    }
  }

  async function startConversion() {
    if (!files.length) {
      setError("Add at least one statement image or scanned PDF.");
      setChecks(defaultChecks({ files: checkFail("No supported file is queued.") }));
      return;
    }
    setBusy(true);
    setError("");
    setChecks(defaultChecks({ files: checkPass(`${files.length} file${files.length === 1 ? "" : "s"} queued.`) }));
    setJob({ ...emptyJob, status: "processing", message: "Loading OCR engine..." });
    try {
      setChecks((current) => updateCheck(current, "worker", checkRunning("Running Tesseract OCR in browser...")));
      const statements = await processImages(files, (pct) => {
        setJob((j) => ({ ...j, message: `OCR in progress: ${pct}%` }));
      });
      if (!statements.length) throw new Error("No financial data could be extracted. Try a clearer image.");

      // Check if Gemini was used (processImages sets source on each statement)
      const geminiUsed = statements.some(s => s.source === "gemini");
      setChecks((current) => ({
        ...current,
        worker: checkPass(geminiUsed ? "Gemini extraction completed." : "OCR completed successfully."),
        gemini: geminiUsed
          ? checkPass("Gemini used — clean extraction.")
          : { ...current.gemini }, // keep existing status from page-load check
        conversion: checkPass(`Extracted ${statements.length} statement(s).`)
      }));
      setJob({
        job_id: crypto.randomUUID(),
        status: "completed",
        message: `Extracted ${statements.length} statement(s) using local OCR.`,
        statements,
        validation: { issues: [], summary: { high: 0, medium: 0, low: 0 } },
        pipeline: [
          { name: "Upload", status: "completed" },
          { name: "Tesseract OCR", status: "completed" },
          { name: "Financial Parsing", status: "completed" }
        ]
      });
      setActiveStatement(0);
    } catch (requestError) {
      setError(cleanError(requestError));
      setChecks((current) => updateCheck(current, "conversion", checkFail(cleanError(requestError))));
      setJob(emptyJob);
    } finally {
      setBusy(false);
    }
  }

  async function exportWorkbook() {
    if (!job.job_id) return;
    setBusy(true);
    setError("");
    try {
      exportToExcel(job.statements);
      setJob((current) => ({ ...current, workbook_url: "#downloaded" }));
    } catch (requestError) {
      setError(cleanError(requestError));
    } finally {
      setBusy(false);
    }
  }

  function updateRow(rowId, field, value) {
    setJob((current) => ({
      ...current,
      statements: current.statements.map((statement, index) => {
        if (index !== activeStatement) return statement;
        return {
          ...statement,
          rows: statement.rows.map((row) => (row.id === rowId ? { ...row, [field]: field === "amount" ? parseNumber(value) : value, confidence: Math.max(row.confidence || 0.5, 0.88) } : row))
        };
      })
    }));
  }

  function addRow() {
    setJob((current) => ({
      ...current,
      statements: current.statements.map((statement, index) =>
        index === activeStatement
          ? {
              ...statement,
              rows: [
                ...statement.rows,
                {
                  id: crypto.randomUUID(),
                  label: "New line item",
                  amount: 0,
                  level: 1,
                  section: "Unclassified",
                  row_type: "line_item",
                  confidence: 0.9,
                  issues: []
                }
              ]
            }
          : statement
      )
    }));
  }

  function deleteRow(rowId) {
    setJob((current) => ({
      ...current,
      statements: current.statements.map((statement, index) => (index === activeStatement ? { ...statement, rows: statement.rows.filter((row) => row.id !== rowId) } : statement))
    }));
  }

  function updateColValue(rowId, colIndex, val) {
    const n = parseNumber(val);
    setJob((current) => ({
      ...current,
      statements: current.statements.map((statement, index) =>
        index !== activeStatement ? statement : {
          ...statement,
          rows: statement.rows.map((row) => {
            if (row.id !== rowId) return row;
            const newVals = [...(row.values || [])];
            newVals[colIndex] = n;
            return { ...row, values: newVals, amount: [...newVals].reverse().find(v => v !== null) || 0 };
          })
        }
      )
    }));
  }

  function reset() {
    setFiles([]);
    setJob(emptyJob);
    setActiveStatement(0);
    setError("");
    setChecks(defaultChecks());
  }

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-emerald-700 text-white">
              <FileSpreadsheet size={23} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-normal">Financials Conversion</h1>
              <p className="text-sm text-zinc-500">OCR, Gemini validation, and accountant-ready Excel output</p>
            </div>
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-600">
            {[["Upload","upload"],["Review","review"],["Export","export"]].map(([label, id], index) => (
              <button
                key={label}
                onClick={() => document.getElementById(id)?.scrollIntoView({ behavior:"smooth", block:"start" })}
                className={`px-5 py-2 transition-colors ${workflowIndex(job) >= index ? "bg-white text-emerald-800" : "hover:bg-zinc-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 xl:grid-cols-[360px_1fr]">
        <aside id="upload" className="space-y-4">
          <section
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              updateFiles(event.dataTransfer.files);
            }}
            className={`rounded-lg border bg-white p-5 shadow-sm ${dragging ? "border-emerald-600 ring-4 ring-emerald-100" : "border-zinc-200"}`}
          >
            <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-center hover:border-emerald-600 hover:bg-emerald-50">
              <FolderUp className="mb-3 text-emerald-700" size={34} />
              <span className="font-bold">Drop or paste statements here</span>
              <span className="mt-1 text-sm text-zinc-500">JPG, PNG, PDFs, screenshots, and multi-page scans</span>
              <input type="file" className="hidden" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => updateFiles(event.target.files)} />
            </label>
            <button type="button" onClick={pasteScreenshot} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60">
              <ClipboardPaste size={17} />
              Paste screenshot from clipboard
            </button>
            {pasteStatus && <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{pasteStatus}</p>}
            <div className="mt-4 space-y-2">
              {files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 text-sm">
                  <span className="truncate pr-3">{file.name}</span>
                  <button className="icon-button text-zinc-500 hover:bg-zinc-100" title="Remove file" onClick={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={startConversion} disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-3 font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
              Convert
            </button>
          </section>

          <StatusPanel job={job} confidence={overallConfidence} />
          <DiagnosticsPanel checks={checks} />
          <ValidationPanel validation={job.validation} />

          <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 font-bold">
              <ShieldCheck size={18} className="text-emerald-700" />
              Pipeline Policy
            </div>
            <p className="text-sm leading-6 text-zinc-600">
              Local preprocessing and OCR are used first. Gemini receives compact OCR and layout metadata only for financial reconstruction, validation, and ambiguity resolution. No Claude integration is present.
            </p>
          </section>
        </aside>

        <section className="min-w-0 rounded-lg border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-4 border-b border-zinc-200 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold">Editable Review</h2>
              <p className="text-sm text-zinc-500">Correct uncertain cells before the workbook is generated.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={addRow} disabled={!currentStatement || busy} className="secondary-button">
                <Plus size={17} />
                Row
              </button>
              <button onClick={reset} disabled={busy} className="secondary-button">
                <RotateCcw size={17} />
                Reset
              </button>
              <button onClick={exportWorkbook} disabled={!job.job_id || busy} className="primary-button">
                <Download size={17} />
                Export Excel
              </button>
            </div>
          </div>

          {error && (
            <div className="mx-5 mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          {!currentStatement ? (
            <EmptyReview />
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto border-b border-zinc-200 px-5 pt-4">
                {job.statements.map((statement, index) => (
                  <button key={statement.id || index} onClick={() => setActiveStatement(index)} className={`whitespace-nowrap rounded-t-lg border border-b-0 px-4 py-2 text-sm font-bold ${activeStatement === index ? "border-zinc-200 bg-white text-emerald-800" : "border-transparent text-zinc-500"}`}>
                    {statement.statement_type}
                  </button>
                ))}
              </div>
              <ReviewTable statement={currentStatement} updateRow={updateRow} deleteRow={deleteRow} updateColValue={updateColValue} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function StatusPanel({ job, confidence }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold">Run Status</h2>
        <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold uppercase text-zinc-600">{job.status}</span>
      </div>
      <p className="text-sm text-zinc-600">{job.message}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Metric label="Confidence" value={`${confidence}%`} />
        <Metric label="Statements" value={job.statements.length} />
      </div>
      <div className="mt-4 space-y-2">
        {(job.pipeline || []).map((step) => (
          <div key={step.name} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
            <span>{step.name}</span>
            <CheckCircle2 size={16} className={step.status === "completed" ? "text-emerald-700" : "text-zinc-400"} />
          </div>
        ))}
      </div>
      {job.workbook_url && (
        <a href={`${API_BASE}${job.workbook_url}`} className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
          <Download size={16} />
          Download latest workbook
        </a>
      )}
    </section>
  );
}

function ValidationPanel({ validation }) {
  const issues = validation?.issues || [];
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">Validation</h2>
        <span className="text-sm font-bold text-zinc-500">{issues.length} issues</span>
      </div>
      <div className="space-y-2">
        {issues.slice(0, 6).map((issue, index) => (
          <div key={`${issue.code}-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle size={15} />
              {issue.severity}
            </div>
            <p className="mt-1">{issue.message}</p>
          </div>
        ))}
        {!issues.length && <p className="text-sm text-zinc-500">No blocking validation issues yet.</p>}
      </div>
    </section>
  );
}

function DiagnosticsPanel({ checks }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold">Conversion Checks</h2>
        <span className="text-xs font-bold uppercase text-zinc-500">Live</span>
      </div>
      <div className="space-y-2">
        {Object.entries(checks).map(([key, check]) => (
          <div key={key} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{check.label}</span>
              <span className={`rounded-full px-2 py-1 text-[11px] font-bold uppercase ${checkTone(check.status)}`}>{check.status}</span>
            </div>
            <p className="mt-1 text-zinc-600">{check.message}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewTable({ statement, updateRow, deleteRow, updateColValue }) {
  const td = statement.tableData;

  if (td && td.columns && td.columns.length > 1) {
    // Multi-year spreadsheet view
    const hasNote = td.rows.some(r => r.note);
    return (
      <div className="overflow-x-auto">
        {statement.unit && (
          <div className="flex justify-end px-4 py-1.5 text-xs text-zinc-400 font-medium border-b border-zinc-100 bg-zinc-50/50">
            <span className="flex items-center gap-1">📊 {statement.unit.replace(/^figures?\s+in\s+/i, "").replace(/^in\s+/i, "").replace(/\b\w/g, c => c.toUpperCase())}</span>
          </div>
        )}
        <table className="w-full text-left text-sm border-collapse">
          <thead className="bg-zinc-50 text-xs font-bold uppercase text-zinc-500 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 border-b border-zinc-200 min-w-[200px] bg-zinc-50">Line Item</th>
              {hasNote && <th className="px-3 py-3 border-b border-zinc-200 text-center whitespace-nowrap bg-zinc-50 min-w-[60px]">Note</th>}
              {td.columns.map((col) => (
                <th key={col} className="px-3 py-3 border-b border-zinc-200 text-right whitespace-nowrap bg-zinc-50 min-w-[90px]">{col}</th>
              ))}
              <th className="px-3 py-3 border-b border-zinc-200 w-10 bg-zinc-50" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {statement.rows.map((row) => {
              const isHeader = row.row_type === "header";
              const isTotal = row.row_type === "total" || row.row_type === "subtotal";
              const isBold = row.is_bold || isHeader || isTotal;
              return (
                <tr key={row.id} className={isHeader ? "bg-zinc-100" : isTotal ? "bg-amber-50/60" : "bg-white hover:bg-zinc-50/60"}>
                  <td className="px-4 py-1.5 border-r border-zinc-100">
                    <input
                      value={row.label || ""}
                      onChange={(e) => updateRow(row.id, "label", e.target.value)}
                      className={`table-input ${isBold ? "font-bold" : "font-medium"}`}
                    />
                  </td>
                  {hasNote && (
                    <td className="px-2 py-1.5 text-center border-r border-zinc-100">
                      <input
                        value={row.note || ""}
                        onChange={(e) => updateRow(row.id, "note", e.target.value)}
                        className="table-input text-center font-mono text-xs w-full text-zinc-500"
                      />
                    </td>
                  )}
                  {(row.values || td.columns.map(() => null)).map((val, ci) => (
                    <td key={ci} className="px-2 py-1.5 text-right">
                      <input
                        value={val !== null && val !== undefined ? val : ""}
                        onChange={(e) => updateColValue(row.id, ci, e.target.value)}
                        className={`table-input text-right font-mono text-xs w-full ${isBold ? "font-bold" : ""}`}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <button onClick={() => deleteRow(row.id)} className="icon-button text-zinc-400 hover:bg-red-50 hover:text-red-700" title="Delete row">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

    // ── Single-column fallback view ────────────────────────────────────────────
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-zinc-50 text-xs font-bold uppercase text-zinc-500">
          <tr>
            <th className="w-56 px-4 py-3">Section</th>
            <th className="px-4 py-3">Line Item</th>
            <th className="w-44 px-4 py-3 text-right">Amount</th>
            <th className="w-32 px-4 py-3">Type</th>
            <th className="w-32 px-4 py-3">Confidence</th>
            <th className="w-12 px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200">
          {statement.rows.map((row) => (
            <tr key={row.id} className={row.confidence < 0.82 || row.issues?.length ? "bg-amber-50/70" : "bg-white"}>
              <td className="px-4 py-2">
                <input value={row.section || ""} onChange={(event) => updateRow(row.id, "section", event.target.value)} className="table-input" />
              </td>
              <td className="px-4 py-2">
                <input value={row.label || ""} onChange={(event) => updateRow(row.id, "label", event.target.value)} className="table-input font-semibold" style={{ paddingLeft: `${Math.min(Number(row.level || 0), 4) * 18 + 10}px` }} />
              </td>
              <td className="px-4 py-2">
                <input value={formatInputNumber(row.amount)} onChange={(event) => updateRow(row.id, "amount", event.target.value)} className="table-input text-right font-mono" />
              </td>
              <td className="px-4 py-2">
                <select value={row.row_type || "line_item"} onChange={(event) => updateRow(row.id, "row_type", event.target.value)} className="table-input">
                  <option value="header">Header</option>
                  <option value="line_item">Line</option>
                  <option value="subtotal">Subtotal</option>
                  <option value="total">Total</option>
                </select>
              </td>
              <td className="px-4 py-2">
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${row.confidence >= 0.9 ? "bg-emerald-50 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                  {Math.round((row.confidence || 0) * 100)}%
                </span>
              </td>
              <td className="px-4 py-2 text-right">
                <button onClick={() => deleteRow(row.id)} className="icon-button text-zinc-500 hover:bg-red-50 hover:text-red-700" title="Delete row">
                  <Trash2 size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyReview() {
  return (
    <div className="grid min-h-[560px] place-items-center p-8 text-center">
      <div>
        <FileText className="mx-auto mb-4 text-zinc-400" size={44} />
        <h2 className="text-lg font-bold">Upload statements to create a review table</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-zinc-500">
          The app will preserve financial structure, flag suspicious OCR rows, and prepare clean Excel sheets for Profit and Loss, Balance Sheet, and Cash Flow statements.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}

function workflowIndex(job) {
  if (job.workbook_url) return 2;
  if (job.statements.length) return 1;
  return 0;
}

function parseNumber(value) {
  const clean = String(value).replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatInputNumber(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function cleanError(error) {
  const message = String(error?.message || error || "The conversion failed.").replace(/^Error:\s*/, "");
  try {
    const parsed = JSON.parse(message);
    if (parsed.detail) return typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
    if (parsed.message) return parsed.message;
    if (parsed.error) return parsed.error;
  } catch {
    return message;
  }
  return message;
}

async function responseError(response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    const message = parsed.detail || parsed.message || parsed.error || text;
    const hint = parsed.hint ? ` ${parsed.hint}` : "";
    return `${response.status} ${response.statusText}: ${message}${hint}`;
  } catch {
    return `${response.status} ${response.statusText}: ${text.slice(0, 300) || "No response body."}`;
  }
}

async function runConversionChecks(files, setChecks) {
  const unsupported = files.filter((file) => !/image\/(png|jpeg|webp)|application\/pdf/.test(file.type) && !/\.(jpe?g|png|webp|pdf)$/i.test(file.name));
  if (unsupported.length) {
    const message = `Unsupported file type: ${unsupported.map((file) => file.name).join(", ")}`;
    setChecks((current) => updateCheck(current, "files", checkFail(message)));
    throw new Error(message);
  }

  setChecks((current) => updateCheck(current, "health", checkRunning("Checking /api/health...")));
  const health = await fetchJson("/api/health");
  setChecks((current) => updateCheck(current, "health", health.ok ? checkPass(`${health.app || "API"} reachable.`) : checkFail("Health endpoint responded but did not report ok.")));

  setChecks((current) => updateCheck(current, "worker", checkRunning("Checking conversion worker and AI/OCR configuration...")));
  const diagnostics = await fetchJson("/api/diagnostics");
  setChecks((current) => ({
    ...current,
    worker: { ...current.worker, ...(diagnostics.conversionJobs ? checkPass(diagnostics.message || "Conversion worker is available.") : checkFail(diagnostics.message || "Conversion worker is not available.")) },
    gemini: { ...current.gemini, ...(
      diagnostics.geminiConfigured
        ? checkPass(diagnostics.message || "Gemini API key is working.")
        : diagnostics.geminiStatus === "invalid_key"
          ? checkFail("Gemini key is invalid or has no API access. Check Google Cloud Console.")
          : diagnostics.geminiStatus === "rate_limit"
            ? checkWarn("Gemini key works but is currently rate-limited.")
            : diagnostics.geminiStatus === "no_models_available"
              ? checkFail("Gemini key present but no models accessible. Enable Gemini API in Google Cloud.")
              : checkWarn("Gemini key not configured; running in OCR-only mode.")
    ) },
    ocr: { ...current.ocr, ...(diagnostics.ocrAvailable ? checkPass("OCR runtime is available.") : checkWarn("OCR runtime is missing or unavailable; fallback OCR path may be used.")) }
  }));
  return diagnostics;
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await responseError(response));
  return response.json();
}

function defaultChecks(overrides = {}) {
  const base = {
    files: { label: "Input file", status: "idle", message: "Waiting for an uploaded or pasted statement image." },
    health: { label: "API health", status: "idle", message: "Not checked yet." },
    worker: { label: "Conversion worker", status: "idle", message: "Not checked yet." },
    ocr: { label: "OCR runtime", status: "idle", message: "Not checked yet." },
    gemini: { label: "Gemini", status: "idle", message: "Not checked yet." },
    conversion: { label: "Job result", status: "idle", message: "Conversion has not started." }
  };
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { ...value, ...(overrides[key] || {}) }]));
}

function updateCheck(current, key, patch) {
  return { ...current, [key]: { ...current[key], ...patch } };
}

function checkPass(message) {
  return { status: "pass", message };
}

function checkFail(message) {
  return { status: "fail", message };
}

function checkWarn(message) {
  return { status: "warn", message };
}

function checkRunning(message) {
  return { status: "checking", message };
}

function checkTone(status) {
  if (status === "pass") return "bg-emerald-100 text-emerald-800";
  if (status === "fail") return "bg-red-100 text-red-800";
  if (status === "warn") return "bg-amber-100 text-amber-900";
  if (status === "checking") return "bg-blue-100 text-blue-800";
  return "bg-zinc-200 text-zinc-600";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function filesFromClipboardItems(items = []) {
  return [...items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const extension = extensionForType(file.type);
      return blobToFile(file, file.name || `pasted-statement-${Date.now()}-${index + 1}.${extension}`);
    })
    .filter(Boolean);
}

function blobToFile(blob, name) {
  return new File([blob], name, { type: blob.type || "image/png", lastModified: Date.now() });
}

function extensionForType(type) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return "png";
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
