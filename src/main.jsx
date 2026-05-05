import React from "react";
import ReactDOM from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
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

  const currentStatement = job.statements[activeStatement] || job.statements[0];
  const overallConfidence = React.useMemo(() => {
    const rows = job.statements.flatMap((statement) => statement.rows || []);
    if (!rows.length) return 0;
    return Math.round((rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length) * 100);
  }, [job.statements]);

  function updateFiles(nextFiles) {
    const accepted = [...nextFiles].filter((file) => /image\/(png|jpeg)|application\/pdf/.test(file.type) || /\.(jpe?g|png|pdf)$/i.test(file.name));
    setFiles((current) => [...current, ...accepted]);
    setError(accepted.length ? "" : "Add JPG, PNG, or scanned PDF files.");
  }

  async function startConversion() {
    if (!files.length) {
      setError("Add at least one statement image or scanned PDF.");
      return;
    }
    setBusy(true);
    setError("");
    setJob({ ...emptyJob, status: "processing", message: "Preprocessing pages and running OCR..." });
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    try {
      const response = await fetch(`${API_BASE}/api/jobs`, { method: "POST", body: formData });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setJob(data);
      setActiveStatement(0);
    } catch (requestError) {
      setError(cleanError(requestError));
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
      const response = await fetch(`${API_BASE}/api/jobs/${job.job_id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statements: job.statements })
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setJob((current) => ({ ...current, workbook_url: data.workbook_url, validation: data.validation }));
      window.location.href = `${API_BASE}${data.workbook_url}`;
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

  function reset() {
    setFiles([]);
    setJob(emptyJob);
    setActiveStatement(0);
    setError("");
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
            {["Upload", "Review", "Export"].map((step, index) => (
              <span key={step} className={`px-5 py-2 ${workflowIndex(job) >= index ? "bg-white text-emerald-800" : ""}`}>
                {step}
              </span>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
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
              <span className="font-bold">Drop statements here</span>
              <span className="mt-1 text-sm text-zinc-500">JPG, PNG, PDFs, and multi-page scans</span>
              <input type="file" className="hidden" multiple accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(event) => updateFiles(event.target.files)} />
            </label>
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
              <ReviewTable statement={currentStatement} updateRow={updateRow} deleteRow={deleteRow} />
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

function ReviewTable({ statement, updateRow, deleteRow }) {
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
  return String(error?.message || error || "The conversion failed.").replace(/^Error:\s*/, "");
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
