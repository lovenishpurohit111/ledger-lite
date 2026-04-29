import express from "express";
import cors from "cors";

export const defaultCategories = [
  "Income",
  "Rent",
  "Salary",
  "Travel",
  "Food",
  "Office Expense",
  "Bank Charges",
  "Miscellaneous"
];

export const defaultRules = [
  { keyword: "uber", account: "Travel" },
  { keyword: "zomato", account: "Food" },
  { keyword: "swiggy", account: "Food" },
  { keyword: "amazon", account: "Office Expense" }
];

export const defaultAccounts = [
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

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({ ok: true, app: "LedgerLite" });
  });

  app.get("/api/defaults", (_request, response) => {
    response.json({
      categories: defaultCategories,
      accounts: defaultAccounts,
      rules: defaultRules
    });
  });

  return app;
}
