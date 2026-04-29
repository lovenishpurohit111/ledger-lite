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
  { keyword: "uber", category: "Travel" },
  { keyword: "zomato", category: "Food" },
  { keyword: "swiggy", category: "Food" },
  { keyword: "amazon", category: "Office Expense" }
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
      rules: defaultRules
    });
  });

  return app;
}
