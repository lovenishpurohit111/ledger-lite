import React from "react";
import ReactDOM from "react-dom/client";
import { ArrowDownCircle, ArrowUpCircle, BarChart3, CalendarDays, CircleDollarSign, LayoutDashboard, Moon, Plus, ReceiptText, Search, Sun, Trash2 } from "lucide-react";
import "./styles.css";

const defaultCategories = ["Income", "Rent", "Salary", "Travel", "Food", "Office Expense", "Bank Charges", "Miscellaneous"];
const defaultRules = [
  { keyword: "uber", category: "Travel" },
  { keyword: "zomato", category: "Food" },
  { keyword: "swiggy", category: "Food" },
  { keyword: "amazon", category: "Office Expense" }
];

const storage = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

function initialTheme() {
  const saved = storage.get("ledgerlite:theme", null);
  if (saved) return saved;
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 7);
}

function monthLabel(value) {
  const [year, month] = value.split("-");
  return new Date(Number(year), Number(month) - 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);
}

function signedAmount(transaction) {
  const amount = Math.abs(Number(transaction.amount) || 0);
  return transaction.category === "Income" ? amount : -amount;
}

function App() {
  const [page, setPage] = React.useState("Dashboard");
  const [month, setMonth] = React.useState(monthKey());
  const [transactions, setTransactions] = React.useState(() => storage.get("ledgerlite:transactions", []));
  const [categories, setCategories] = React.useState(() => storage.get("ledgerlite:categories", defaultCategories));
  const [rules, setRules] = React.useState(() => storage.get("ledgerlite:rules", defaultRules));
  const [categoryName, setCategoryName] = React.useState("");
  const [theme, setTheme] = React.useState(initialTheme);

  React.useEffect(() => storage.set("ledgerlite:transactions", transactions), [transactions]);
  React.useEffect(() => storage.set("ledgerlite:categories", categories), [categories]);
  React.useEffect(() => storage.set("ledgerlite:rules", rules), [rules]);
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    storage.set("ledgerlite:theme", theme);
  }, [theme]);

  const visibleTransactions = React.useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(month)),
    [transactions, month]
  );

  const totals = React.useMemo(() => getTotals(visibleTransactions), [visibleTransactions]);
  const expenses = React.useMemo(() => getExpenseBreakdown(visibleTransactions), [visibleTransactions]);
  const months = React.useMemo(() => getRecentMonths(transactions), [transactions]);

  function suggestCategory(description) {
    const text = description.toLowerCase();
    return rules.find((rule) => text.includes(rule.keyword.toLowerCase()))?.category || "Miscellaneous";
  }

  function addTransaction(transaction) {
    setTransactions((current) => [{ ...transaction, id: crypto.randomUUID() }, ...current]);
    const words = transaction.description.toLowerCase().split(/\s+/).filter(Boolean);
    const keyword = words[0];
    if (keyword && !rules.some((rule) => rule.keyword === keyword) && transaction.category !== "Miscellaneous") {
      setRules((current) => [...current, { keyword, category: transaction.category }]);
    }
  }

  function updateCategory(id, category) {
    setTransactions((current) => current.map((transaction) => (transaction.id === id ? { ...transaction, category } : transaction)));
  }

  function deleteTransaction(id) {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
  }

  function addCategory(event) {
    event.preventDefault();
    const cleanName = categoryName.trim();
    if (!cleanName || categories.includes(cleanName)) return;
    setCategories((current) => [...current, cleanName]);
    setCategoryName("");
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbeafe_0,#f8fafc_34%,#eef2ff_100%)] text-ledger-ink transition-colors dark:bg-[radial-gradient(circle_at_top_left,#172554_0,#020617_42%,#0f172a_100%)] dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 border-r border-white/70 bg-white/82 px-5 py-6 shadow-[12px_0_35px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/82 dark:shadow-[12px_0_45px_rgba(0,0,0,0.35)] lg:block">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-emerald-500 text-white shadow-lg shadow-blue-500/25">
            <CircleDollarSign size={24} />
          </div>
          <div>
            <p className="text-xl font-bold">LedgerLite</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">Small business finance</p>
          </div>
        </div>
        <nav className="space-y-2">
          {[
            ["Dashboard", LayoutDashboard],
            ["Transactions", ReceiptText],
            ["Reports", BarChart3]
          ].map(([label, Icon]) => (
            <button
              key={label}
              onClick={() => setPage(label)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                page === label
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-5 py-4 text-slate-950 shadow-sm backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95 dark:text-white lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">{page}</p>
              <h1 className="text-2xl font-bold text-slate-950 dark:text-white">LedgerLite</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              >
                {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
              </button>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                <CalendarDays size={18} className="text-slate-500 dark:text-slate-400" />
                <input value={month} onChange={(event) => setMonth(event.target.value)} type="month" className="bg-transparent text-slate-900 outline-none dark:text-slate-100" />
              </label>
            </div>
          </div>
        </header>

        <div className="px-5 py-6 lg:px-8">
          <MobileNav page={page} setPage={setPage} />
          {page === "Dashboard" && <Dashboard totals={totals} expenses={expenses} months={months} currentMonth={month} transactions={transactions} />}
          {page === "Transactions" && (
            <Transactions
              month={month}
              transactions={visibleTransactions}
              categories={categories}
              categoryName={categoryName}
              setCategoryName={setCategoryName}
              addCategory={addCategory}
              addTransaction={addTransaction}
              updateCategory={updateCategory}
              deleteTransaction={deleteTransaction}
              suggestCategory={suggestCategory}
            />
          )}
          {page === "Reports" && <Reports totals={totals} expenses={expenses} month={month} />}
        </div>
      </main>
    </div>
  );
}

function MobileNav({ page, setPage }) {
  return (
    <div className="mb-5 grid grid-cols-3 gap-2 lg:hidden">
      {["Dashboard", "Transactions", "Reports"].map((label) => (
        <button
          key={label}
          onClick={() => setPage(label)}
          className={`rounded-xl px-3 py-2 text-sm font-semibold shadow-sm transition ${
            page === label ? "bg-blue-600 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Dashboard({ totals, expenses, months, currentMonth, transactions }) {
  const monthlyTotals = months.map((month) => getTotals(transactions.filter((transaction) => transaction.date.startsWith(month))));
  const peak = Math.max(...monthlyTotals.map((item) => Math.max(item.income, item.expenses)), 1);

  return (
    <section className="space-y-6">
      <SummaryCards totals={totals} />
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card title="Expense Breakdown" subtitle={monthLabel(currentMonth)}>
          <Breakdown expenses={expenses} />
        </Card>
        <Card title="Monthly Snapshot" subtitle="Income and expenses">
          <div className="flex h-72 items-end gap-4">
            {months.map((month, index) => (
              <div key={month} className="flex flex-1 flex-col items-center gap-3">
                <div className="flex h-56 w-full items-end justify-center gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-2 pb-2 dark:border-slate-800 dark:bg-slate-950/70">
                  <div className="w-5 rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-lg shadow-emerald-500/20" style={{ height: `${(monthlyTotals[index].income / peak) * 100}%` }} />
                  <div className="w-5 rounded-t-lg bg-gradient-to-t from-rose-600 to-rose-400 shadow-lg shadow-rose-500/20" style={{ height: `${(monthlyTotals[index].expenses / peak) * 100}%` }} />
                </div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{monthLabel(month).slice(0, 3)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function Transactions({ month, transactions, categories, categoryName, setCategoryName, addCategory, addTransaction, updateCategory, deleteTransaction, suggestCategory }) {
  return (
    <section className="space-y-6">
      <TransactionForm categories={categories} addTransaction={addTransaction} suggestCategory={suggestCategory} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card title="Transactions" subtitle={`${transactions.length} entries for ${monthLabel(month)}`}>
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
            <Search size={18} />
            <span className="text-sm">Filtered by selected month</span>
          </div>
          <TransactionTable transactions={transactions} categories={categories} updateCategory={updateCategory} deleteTransaction={deleteTransaction} />
        </Card>
        <Card title="Categories" subtitle="Add your own labels">
          <form onSubmit={addCategory} className="flex gap-2">
            <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="New category" className="input" />
            <button className="icon-button bg-blue-600 text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:bg-blue-700" title="Add category">
              <Plus size={18} />
            </button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {categories.map((category) => (
              <span key={category} className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {category}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function Reports({ totals, expenses, month }) {
  return (
    <section className="space-y-6">
      <SummaryCards totals={totals} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Profit & Loss" subtitle={monthLabel(month)}>
          <ReportRow label="Total Income" value={totals.income} positive />
          <ReportRow label="Total Expenses" value={totals.expenses} />
          <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
            <ReportRow label="Net Profit" value={totals.net} strong positive={totals.net >= 0} />
          </div>
        </Card>
        <Card title="Expense Breakdown" subtitle="Grouped by category">
          <Breakdown expenses={expenses} />
        </Card>
      </div>
    </section>
  );
}

function TransactionForm({ categories, addTransaction, suggestCategory }) {
  const [form, setForm] = React.useState({ date: today(), amount: "", description: "", category: "Miscellaneous" });
  const [bulkText, setBulkText] = React.useState("");
  const [error, setError] = React.useState("");
  const amountRef = React.useRef(null);

  React.useEffect(() => amountRef.current?.focus(), []);

  function update(field, value) {
    const next = { ...form, [field]: value };
    if (field === "description") next.category = suggestCategory(value);
    setForm(next);
  }

  function submit(event) {
    event.preventDefault();
    if (!Number(form.amount) || Number(form.amount) <= 0) return setError("Enter a valid amount.");
    if (!form.description.trim()) return setError("Add a short description.");
    addTransaction({ ...form, amount: Number(form.amount), description: form.description.trim() });
    setForm({ date: today(), amount: "", description: "", category: "Miscellaneous" });
    setError("");
    amountRef.current?.focus();
  }

  function parseBulk() {
    const entries = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?)[\s,]+(-?\d+(?:\.\d+)?)$/);
        if (!match) return null;
        const description = match[1].trim();
        return {
          date: today(),
          amount: Math.abs(Number(match[2])),
          description,
          category: suggestCategory(description)
        };
      })
      .filter(Boolean);
    entries.forEach(addTransaction);
    if (entries.length) setBulkText("");
  }

  return (
    <Card title="Quick Entry" subtitle="Press Enter to save">
      <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[150px_150px_1fr_190px_auto]">
        <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className="input" />
        <input ref={amountRef} type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="Amount" className="input" />
        <input value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Description, e.g. Uber ride" className="input" />
        <select value={form.category} onChange={(event) => update("category", event.target.value)} className="input">
          {categories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
        <button className="rounded-xl bg-gradient-to-r from-blue-600 to-emerald-500 px-5 py-3 font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:-translate-y-0.5 hover:shadow-xl">Add</button>
      </form>
      {error && <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-300">{error}</p>}
      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
        <textarea value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={"Bulk paste: Uber 200\nZomato 300\nRent 10000"} className="input min-h-24 resize-y" />
        <button onClick={parseBulk} className="rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
          Parse Bulk
        </button>
      </div>
    </Card>
  );
}

function SummaryCards({ totals }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <MetricCard title="Total Income" value={totals.income} tone="green" icon={ArrowUpCircle} />
      <MetricCard title="Total Expenses" value={totals.expenses} tone="red" icon={ArrowDownCircle} />
      <MetricCard title="Net Profit" value={totals.net} tone="blue" icon={CircleDollarSign} />
    </div>
  );
}

function MetricCard({ title, value, tone, icon: Icon }) {
  const toneClass = {
    green: "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300",
    red: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
  }[tone];
  return (
    <div className="premium-card p-5 transition hover:-translate-y-1 hover:shadow-[0_24px_60px_rgba(37,99,235,0.12)] dark:hover:shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{title}</p>
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${toneClass}`}>
          <Icon size={20} />
        </span>
      </div>
      <p className="mt-4 text-3xl font-bold">{formatMoney(value)}</p>
    </div>
  );
}

function TransactionTable({ transactions, categories, updateCategory, deleteTransaction }) {
  if (!transactions.length) return <EmptyState />;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Description</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Category</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
          {transactions.map((transaction) => (
            <tr key={transaction.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{transaction.date}</td>
              <td className="px-4 py-3 font-medium">{transaction.description}</td>
              <td className={`px-4 py-3 font-semibold ${transaction.category === "Income" ? "text-green-600 dark:text-green-300" : "text-red-600 dark:text-red-300"}`}>{formatMoney(transaction.amount)}</td>
              <td className="px-4 py-3">
                <select value={transaction.category} onChange={(event) => updateCategory(transaction.id, event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => deleteTransaction(transaction.id)} className="icon-button text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10" title="Delete transaction">
                  <Trash2 size={18} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return (
    <section className="premium-card p-5">
      <div className="mb-5">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function Breakdown({ expenses }) {
  if (!expenses.length) return <EmptyState />;
  const peak = Math.max(...expenses.map((item) => item.total), 1);
  return (
    <div className="space-y-4">
      {expenses.map((item) => (
        <div key={item.category}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">{item.category}</span>
            <span className="font-semibold text-slate-600 dark:text-slate-300">{formatMoney(item.total)}</span>
          </div>
          <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800">
            <div className="h-3 rounded-full bg-gradient-to-r from-blue-600 to-emerald-500 shadow-sm shadow-blue-500/30" style={{ width: `${(item.total / peak) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportRow({ label, value, positive, strong }) {
  return (
    <div className={`flex items-center justify-between py-3 ${strong ? "text-lg font-bold" : "border-b border-slate-100 font-semibold dark:border-slate-800"}`}>
      <span>{label}</span>
      <span className={positive ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}>{formatMoney(value)}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center dark:border-slate-700 dark:bg-slate-950/50">
      <p className="font-semibold text-slate-700 dark:text-slate-200">No transactions yet</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add one above and reports update instantly.</p>
    </div>
  );
}

function getTotals(transactions) {
  return transactions.reduce(
    (totals, transaction) => {
      const amount = Math.abs(Number(transaction.amount) || 0);
      if (transaction.category === "Income") totals.income += amount;
      else totals.expenses += amount;
      totals.net = totals.income - totals.expenses;
      return totals;
    },
    { income: 0, expenses: 0, net: 0 }
  );
}

function getExpenseBreakdown(transactions) {
  const groups = transactions.reduce((map, transaction) => {
    if (signedAmount(transaction) >= 0) return map;
    map[transaction.category] = (map[transaction.category] || 0) + Math.abs(Number(transaction.amount) || 0);
    return map;
  }, {});
  return Object.entries(groups)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

function getRecentMonths(transactions) {
  const set = new Set([monthKey()]);
  transactions.forEach((transaction) => set.add(transaction.date.slice(0, 7)));
  return [...set].sort().slice(-6);
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
