import React from "react";
import ReactDOM from "react-dom/client";
import { ArrowDownCircle, ArrowUpCircle, BarChart3, CalendarDays, CircleDollarSign, Landmark, LayoutDashboard, Moon, Plus, ReceiptText, Search, Sun, Trash2 } from "lucide-react";
import "./styles.css";

const defaultCategories = ["Income", "Rent", "Salary", "Travel", "Food", "Office Expense", "Bank Charges", "Miscellaneous"];
const defaultRules = [
  { keyword: "uber", account: "Travel" },
  { keyword: "zomato", account: "Food" },
  { keyword: "swiggy", account: "Food" },
  { keyword: "amazon", account: "Office Expense" }
];

const defaultAccounts = [
  { name: "Bank Account", type: "Current Asset" },
  { name: "Cash", type: "Current Asset" },
  { name: "Accounts Receivable", type: "Current Asset" },
  { name: "Inventory", type: "Other Current Asset" },
  { name: "Prepaid Expenses", type: "Other Current Asset" },
  { name: "Equipment", type: "Fixed Asset" },
  { name: "Accounts Payable", type: "Current Liability" },
  { name: "Credit Card", type: "Current Liability" },
  { name: "GST / Sales Tax Payable", type: "Other Current Liability" },
  { name: "Loan Payable", type: "Long-term Liability" },
  { name: "Owner Equity", type: "Equity" },
  { name: "Sales Income", type: "Income" },
  { name: "Service Income", type: "Income" },
  { name: "Cost of Goods Sold", type: "Cost of Goods Sold" },
  { name: "Rent", type: "Expense" },
  { name: "Salary", type: "Expense" },
  { name: "Travel", type: "Expense" },
  { name: "Food", type: "Expense" },
  { name: "Office Expense", type: "Expense" },
  { name: "Bank Charges", type: "Expense" },
  { name: "Miscellaneous", type: "Other Expense" }
];

const accountTypes = [
  "Current Asset",
  "Other Current Asset",
  "Fixed Asset",
  "Current Liability",
  "Other Current Liability",
  "Long-term Liability",
  "Equity",
  "Income",
  "Cost of Goods Sold",
  "Expense",
  "Other Expense"
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

function normalizeTransaction(transaction) {
  if (transaction.debitAccount && transaction.creditAccount) return transaction;
  const amount = Math.abs(Number(transaction.amount) || 0);
  const isIncome = transaction.category === "Income";
  return {
    ...transaction,
    amount,
    debitAccount: isIncome ? "Bank Account" : transaction.category || "Miscellaneous",
    creditAccount: isIncome ? "Sales Income" : "Bank Account"
  };
}

function mergeAccounts(savedAccounts) {
  const saved = Array.isArray(savedAccounts) ? savedAccounts : [];
  const normalized = saved.map((account) => ({
    ...account,
    type: normalizeAccountType(account.type)
  }));
  const names = new Set(normalized.map((account) => account.name.toLowerCase()));
  return [...normalized, ...defaultAccounts.filter((account) => !names.has(account.name.toLowerCase()))];
}

function normalizeAccountType(type) {
  if (type === "Asset") return "Current Asset";
  if (type === "Liability") return "Current Liability";
  if (type === "Expense") return "Expense";
  return type || "Expense";
}

function accountClass(type) {
  if (type.includes("Asset")) return "Asset";
  if (type.includes("Liability")) return "Liability";
  if (type === "Equity") return "Equity";
  if (type === "Income") return "Income";
  return "Expense";
}

function accountNormalSide(type) {
  const classification = accountClass(type);
  return classification === "Asset" || classification === "Expense" ? "Debit" : "Credit";
}

function accountBalance(accountName, accountType, transactions) {
  return transactions.reduce((balance, transaction) => {
    const amount = Math.abs(Number(transaction.amount) || 0);
    const debit = transaction.debitAccount === accountName ? amount : 0;
    const credit = transaction.creditAccount === accountName ? amount : 0;
    return accountNormalSide(accountType) === "Debit" ? balance + debit - credit : balance + credit - debit;
  }, 0);
}

function accountType(name, accounts) {
  return accounts.find((account) => account.name === name)?.type || "Expense";
}

function App() {
  const [page, setPage] = React.useState("Dashboard");
  const [month, setMonth] = React.useState(monthKey());
  const [transactions, setTransactions] = React.useState(() => storage.get("ledgerlite:transactions", []).map(normalizeTransaction));
  const [categories, setCategories] = React.useState(() => storage.get("ledgerlite:categories", defaultCategories));
  const [rules, setRules] = React.useState(() => storage.get("ledgerlite:rules", defaultRules));
  const [accounts, setAccounts] = React.useState(() => mergeAccounts(storage.get("ledgerlite:accounts", defaultAccounts)));
  const [accountForm, setAccountForm] = React.useState({ name: "", type: "Expense" });
  const [theme, setTheme] = React.useState(initialTheme);

  React.useEffect(() => storage.set("ledgerlite:transactions", transactions), [transactions]);
  React.useEffect(() => storage.set("ledgerlite:categories", categories), [categories]);
  React.useEffect(() => storage.set("ledgerlite:rules", rules), [rules]);
  React.useEffect(() => storage.set("ledgerlite:accounts", accounts), [accounts]);
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    storage.set("ledgerlite:theme", theme);
  }, [theme]);

  const visibleTransactions = React.useMemo(
    () => transactions.filter((transaction) => transaction.date.startsWith(month)),
    [transactions, month]
  );

  const totals = React.useMemo(() => getTotals(visibleTransactions, accounts), [visibleTransactions, accounts]);
  const expenses = React.useMemo(() => getExpenseBreakdown(visibleTransactions, accounts), [visibleTransactions, accounts]);
  const months = React.useMemo(() => getRecentMonths(transactions), [transactions]);
  const accountBalances = React.useMemo(() => getAccountBalances(accounts, transactions), [accounts, transactions]);
  const balanceSheet = React.useMemo(() => getBalanceSheet(accounts, transactions, month), [accounts, transactions, month]);

  function suggestAccount(description) {
    const text = description.toLowerCase();
    return rules.find((rule) => text.includes(rule.keyword.toLowerCase()))?.account || rules.find((rule) => text.includes(rule.keyword.toLowerCase()))?.category || "Miscellaneous";
  }

  function addTransaction(transaction) {
    setTransactions((current) => [{ ...transaction, id: crypto.randomUUID() }, ...current]);
    const words = transaction.description.toLowerCase().split(/\s+/).filter(Boolean);
    const keyword = words[0];
    if (keyword && !rules.some((rule) => rule.keyword === keyword) && transaction.debitAccount !== "Miscellaneous") {
      setRules((current) => [...current, { keyword, account: transaction.debitAccount }]);
    }
  }

  function updateTransactionAccount(id, field, account) {
    setTransactions((current) => current.map((transaction) => (transaction.id === id ? { ...transaction, [field]: account } : transaction)));
  }

  function deleteTransaction(id) {
    setTransactions((current) => current.filter((transaction) => transaction.id !== id));
  }

  function addAccount(event) {
    event?.preventDefault();
    const cleanName = accountForm.name.trim();
    if (!cleanName || accounts.some((account) => account.name.toLowerCase() === cleanName.toLowerCase())) return false;
    setAccounts((current) => [...current, { name: cleanName, type: accountForm.type }]);
    if (accountClass(accountForm.type) === "Expense" && !categories.includes(cleanName)) setCategories((current) => [...current, cleanName]);
    setAccountForm({ name: "", type: "Expense" });
    return true;
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 border-r border-slate-200 bg-white px-5 py-6 shadow-sm dark:border-slate-800 dark:bg-slate-950 lg:block">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
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
            ["Chart of Accounts", Landmark],
            ["Reports", BarChart3]
          ].map(([label, Icon]) => (
            <button
              key={label}
              onClick={() => setPage(label)}
              className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold transition ${
                page === label
                  ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-500/20"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
              }`}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-5 py-4 text-slate-950 shadow-sm dark:border-slate-800 dark:bg-slate-950 dark:text-white lg:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{page}</p>
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
          {page === "Dashboard" && <Dashboard totals={totals} expenses={expenses} months={months} currentMonth={month} transactions={transactions} accounts={accounts} />}
          {page === "Transactions" && (
            <Transactions
              month={month}
              transactions={visibleTransactions}
              accounts={accounts}
              accountForm={accountForm}
              setAccountForm={setAccountForm}
              addAccount={addAccount}
              addTransaction={addTransaction}
              updateTransactionAccount={updateTransactionAccount}
              deleteTransaction={deleteTransaction}
              suggestAccount={suggestAccount}
            />
          )}
          {page === "Chart of Accounts" && <ChartOfAccounts balances={accountBalances} accountForm={accountForm} setAccountForm={setAccountForm} addAccount={addAccount} />}
          {page === "Reports" && <Reports totals={totals} expenses={expenses} month={month} accounts={accounts} transactions={visibleTransactions} balanceSheet={balanceSheet} />}
        </div>
      </main>
    </div>
  );
}

function MobileNav({ page, setPage }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:hidden">
      {["Dashboard", "Transactions", "Chart of Accounts", "Reports"].map((label) => (
        <button
          key={label}
          onClick={() => setPage(label)}
          className={`rounded-xl px-3 py-2 text-sm font-semibold shadow-sm transition ${
            page === label ? "bg-emerald-700 text-white" : "bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Dashboard({ totals, expenses, months, currentMonth, transactions, accounts }) {
  const monthlyTotals = months.map((month) => getTotals(transactions.filter((transaction) => transaction.date.startsWith(month)), accounts));
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
                  <div className="w-5 rounded-t-lg bg-emerald-600" style={{ height: `${(monthlyTotals[index].income / peak) * 100}%` }} />
                  <div className="w-5 rounded-t-lg bg-slate-400 dark:bg-slate-500" style={{ height: `${(monthlyTotals[index].expenses / peak) * 100}%` }} />
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

function Transactions({ month, transactions, accounts, accountForm, setAccountForm, addAccount, addTransaction, updateTransactionAccount, deleteTransaction, suggestAccount }) {
  return (
    <section className="space-y-6">
      <TransactionForm accounts={accounts} addTransaction={addTransaction} suggestAccount={suggestAccount} />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card title="Transactions" subtitle={`${transactions.length} entries for ${monthLabel(month)}`}>
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-slate-500 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-400">
            <Search size={18} />
            <span className="text-sm">Every row posts equal debit and credit entries</span>
          </div>
          <TransactionTable transactions={transactions} accounts={accounts} updateTransactionAccount={updateTransactionAccount} deleteTransaction={deleteTransaction} />
        </Card>
        <Card title="Create Account" subtitle="Add it if it is not available">
          <form onSubmit={addAccount} className="space-y-3">
            <input value={accountForm.name} onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))} placeholder="Account name" className="input" />
            <select value={accountForm.type} onChange={(event) => setAccountForm((current) => ({ ...current, type: event.target.value }))} className="input">
              {accountTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <button className="icon-button bg-emerald-700 text-white shadow-sm transition hover:bg-emerald-800" title="Add account">
              <Plus size={18} />
            </button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {accounts.slice(0, 8).map((account) => (
              <span key={account.name} className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {account.name}
              </span>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}

function ChartOfAccounts({ balances, accountForm, setAccountForm, addAccount }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card title="Chart of Accounts" subtitle="Accounts used for debit and credit postings">
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Account</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Normal Side</th>
                <th className="px-4 py-3 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
              {balances.map((account) => (
                <tr key={account.name} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-3 font-semibold">{account.name}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{account.type}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{accountNormalSide(account.type)}</td>
                  <td className="px-4 py-3 text-right font-bold">{formatMoney(account.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="New Account" subtitle="Create the account if it is missing">
        <form onSubmit={addAccount} className="space-y-3">
          <input value={accountForm.name} onChange={(event) => setAccountForm((current) => ({ ...current, name: event.target.value }))} placeholder="Account name, e.g. HDFC Bank" className="input" />
          <select value={accountForm.type} onChange={(event) => setAccountForm((current) => ({ ...current, type: event.target.value }))} className="input">
            {accountTypes.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <button className="w-full rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-800">
            Add Account
          </button>
        </form>
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
          Assets and expenses normally increase with debits. Income, liabilities, and equity normally increase with credits.
        </div>
      </Card>
    </section>
  );
}

function Reports({ totals, expenses, month, accounts, transactions, balanceSheet }) {
  const balances = getAccountBalances(accounts, transactions);
  return (
    <section className="space-y-6">
      <SummaryCards totals={totals} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Profit & Loss" subtitle={monthLabel(month)}>
          <ReportRow label="Total Income" value={totals.income} positive />
          <ReportRow label="Total Expenses" value={totals.expenses} />
          <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
            <ReportRow label="Net Profit" value={totals.net} strong positive={totals.net >= 0} />
          </div>
        </Card>
        <Card title="Balance Sheet" subtitle={`As of ${monthLabel(month)}`}>
          <BalanceSheetSummary balanceSheet={balanceSheet} />
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Expense Breakdown" subtitle="Grouped by account">
          <Breakdown expenses={expenses} />
        </Card>
        <Card title="Balance Sheet Detail" subtitle="Assets, liabilities, and equity">
          <BalanceSheetDetail balanceSheet={balanceSheet} />
        </Card>
      </div>
      <Card title="Account Movement" subtitle="Debit and credit impact for selected month">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {balances
            .filter((account) => account.balance !== 0)
            .map((account) => (
              <div key={account.name} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
                <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">{account.type}</p>
                <p className="mt-1 font-bold">{account.name}</p>
                <p className="mt-3 text-xl font-bold">{formatMoney(account.balance)}</p>
              </div>
            ))}
        </div>
      </Card>
    </section>
  );
}

function BalanceSheetSummary({ balanceSheet }) {
  const difference = balanceSheet.assets.total - (balanceSheet.liabilities.total + balanceSheet.equity.total);
  return (
    <div className="space-y-3">
      <ReportRow label="Total Assets" value={balanceSheet.assets.total} positive />
      <ReportRow label="Total Liabilities" value={balanceSheet.liabilities.total} />
      <ReportRow label="Total Equity" value={balanceSheet.equity.total} positive />
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
        <ReportRow label="Difference" value={difference} strong positive={Math.abs(difference) < 1} />
      </div>
    </div>
  );
}

function BalanceSheetDetail({ balanceSheet }) {
  return (
    <div className="space-y-5">
      <BalanceSection title="Assets" groups={balanceSheet.assets.groups} total={balanceSheet.assets.total} />
      <BalanceSection title="Liabilities" groups={balanceSheet.liabilities.groups} total={balanceSheet.liabilities.total} />
      <BalanceSection title="Equity" groups={balanceSheet.equity.groups} total={balanceSheet.equity.total} />
    </div>
  );
}

function BalanceSection({ title, groups, total }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2 text-sm font-bold dark:border-slate-800">
        <span>{title}</span>
        <span>{formatMoney(total)}</span>
      </div>
      {Object.entries(groups).map(([group, accounts]) => (
        <div key={group} className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{group}</p>
          {accounts.map((account) => (
            <div key={account.name} className="flex justify-between py-1 text-sm">
              <span>{account.name}</span>
              <span className="font-semibold">{formatMoney(account.balance)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TransactionForm({ accounts, addTransaction, suggestAccount }) {
  const assetAccounts = accounts.filter((account) => accountClass(account.type) === "Asset");
  const incomeAccounts = accounts.filter((account) => accountClass(account.type) === "Income");
  const expenseAccounts = accounts.filter((account) => accountClass(account.type) === "Expense");
  const [form, setForm] = React.useState({
    date: today(),
    amount: "",
    description: "",
    type: "Expense",
    debitAccount: "Miscellaneous",
    creditAccount: "Bank Account"
  });
  const [bulkText, setBulkText] = React.useState("");
  const [error, setError] = React.useState("");
  const amountRef = React.useRef(null);

  React.useEffect(() => amountRef.current?.focus(), []);

  function update(field, value) {
    const next = { ...form, [field]: value };
    if (field === "description" && form.type === "Expense") next.debitAccount = suggestAccount(value);
    if (field === "type" && value === "Income") {
      next.debitAccount = assetAccounts[0]?.name || "Bank Account";
      next.creditAccount = incomeAccounts[0]?.name || "Sales Income";
    }
    if (field === "type" && value === "Expense") {
      next.debitAccount = suggestAccount(form.description) || expenseAccounts[0]?.name || "Miscellaneous";
      next.creditAccount = assetAccounts[0]?.name || "Bank Account";
    }
    setForm(next);
  }

  function submit(event) {
    event.preventDefault();
    if (!Number(form.amount) || Number(form.amount) <= 0) return setError("Enter a valid amount.");
    if (!form.description.trim()) return setError("Add a short description.");
    if (form.debitAccount === form.creditAccount) return setError("Debit and credit accounts must be different.");
    addTransaction({ ...form, amount: Number(form.amount), description: form.description.trim(), category: form.type === "Income" ? "Income" : form.debitAccount });
    setForm({ date: today(), amount: "", description: "", type: "Expense", debitAccount: "Miscellaneous", creditAccount: assetAccounts[0]?.name || "Bank Account" });
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
          type: "Expense",
          debitAccount: suggestAccount(description),
          creditAccount: assetAccounts[0]?.name || "Bank Account",
          category: suggestAccount(description)
        };
      })
      .filter(Boolean);
    entries.forEach(addTransaction);
    if (entries.length) setBulkText("");
  }

  return (
    <Card title="Quick Entry" subtitle="Press Enter to save">
      <form onSubmit={submit} className="grid gap-3 xl:grid-cols-[130px_150px_150px_1fr_190px_190px_auto]">
        <input type="date" value={form.date} onChange={(event) => update("date", event.target.value)} className="input" />
        <select value={form.type} onChange={(event) => update("type", event.target.value)} className="input">
          <option>Expense</option>
          <option>Income</option>
        </select>
        <input ref={amountRef} type="number" min="0" step="0.01" value={form.amount} onChange={(event) => update("amount", event.target.value)} placeholder="Amount" className="input" />
        <input value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Description, e.g. Uber ride" className="input" />
        <select value={form.debitAccount} onChange={(event) => update("debitAccount", event.target.value)} className="input" title="Debit account">
          {(form.type === "Income" ? assetAccounts : expenseAccounts).map((account) => (
            <option key={account.name}>{account.name}</option>
          ))}
        </select>
        <select value={form.creditAccount} onChange={(event) => update("creditAccount", event.target.value)} className="input" title="Credit account">
          {(form.type === "Income" ? incomeAccounts : assetAccounts).map((account) => (
            <option key={account.name}>{account.name}</option>
          ))}
        </select>
        <button className="rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-800">Add</button>
      </form>
      <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
        {form.type === "Expense" ? `Debit ${form.debitAccount}, credit ${form.creditAccount}.` : `Debit ${form.debitAccount}, credit ${form.creditAccount}.`}
      </p>
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
    blue: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
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

function TransactionTable({ transactions, accounts, updateTransactionAccount, deleteTransaction }) {
  if (!transactions.length) return <EmptyState />;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
      <table className="w-full min-w-[840px] text-left text-sm">
        <thead className="bg-slate-50 text-slate-500 dark:bg-slate-950/70 dark:text-slate-400">
          <tr>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Description</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Debit</th>
            <th className="px-4 py-3 font-semibold">Credit</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900/40">
          {transactions.map((transaction) => (
            <tr key={transaction.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
              <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{transaction.date}</td>
              <td className="px-4 py-3 font-medium">{transaction.description}</td>
              <td className={`px-4 py-3 font-semibold ${accountType(transaction.creditAccount, accounts) === "Income" ? "text-green-600 dark:text-green-300" : "text-red-600 dark:text-red-300"}`}>{formatMoney(transaction.amount)}</td>
              <td className="px-4 py-3">
                <select value={transaction.debitAccount} onChange={(event) => updateTransactionAccount(transaction.id, "debitAccount", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  {accounts.map((account) => (
                    <option key={account.name}>{account.name}</option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
                <select value={transaction.creditAccount} onChange={(event) => updateTransactionAccount(transaction.id, "creditAccount", event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  {accounts.map((account) => (
                    <option key={account.name}>{account.name}</option>
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
            <div className="h-3 rounded-full bg-emerald-700" style={{ width: `${(item.total / peak) * 100}%` }} />
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

function getTotals(transactions, accounts = defaultAccounts) {
  return transactions.reduce(
    (totals, transaction) => {
      const amount = Math.abs(Number(transaction.amount) || 0);
      if (accountClass(accountType(transaction.creditAccount, accounts)) === "Income") totals.income += amount;
      else totals.expenses += amount;
      totals.net = totals.income - totals.expenses;
      return totals;
    },
    { income: 0, expenses: 0, net: 0 }
  );
}

function getExpenseBreakdown(transactions, accounts = defaultAccounts) {
  const groups = transactions.reduce((map, transaction) => {
    if (accountClass(accountType(transaction.debitAccount, accounts)) !== "Expense") return map;
    map[transaction.debitAccount] = (map[transaction.debitAccount] || 0) + Math.abs(Number(transaction.amount) || 0);
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

function getAccountBalances(accounts, transactions) {
  return accounts.map((account) => ({
    ...account,
    balance: accountBalance(account.name, account.type, transactions)
  }));
}

function monthEndDate(month) {
  const [year, value] = month.split("-").map(Number);
  return new Date(year, value, 0).toISOString().slice(0, 10);
}

function getBalanceSheet(accounts, transactions, month) {
  const asOf = monthEndDate(month);
  const included = transactions.filter((transaction) => transaction.date <= asOf);
  const balances = getAccountBalances(accounts, included);
  const profit = getTotals(included, accounts).net;

  const sections = {
    assets: buildBalanceSection(balances, "Asset"),
    liabilities: buildBalanceSection(balances, "Liability"),
    equity: buildBalanceSection(
      [
        ...balances.filter((account) => accountClass(account.type) === "Equity"),
        { name: "Retained Earnings", type: "Equity", balance: profit }
      ],
      "Equity"
    )
  };

  return sections;
}

function buildBalanceSection(balances, classification) {
  const filtered = balances.filter((account) => accountClass(account.type) === classification && account.balance !== 0);
  const groups = filtered.reduce((current, account) => {
    current[account.type] = current[account.type] || [];
    current[account.type].push(account);
    return current;
  }, {});
  return {
    groups,
    total: filtered.reduce((sum, account) => sum + account.balance, 0)
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
