import { defaultAccounts, defaultCategories, defaultRules } from "./app.js";

export default function handler(_request, response) {
  response.status(200).json({
    accounts: defaultAccounts,
    categories: defaultCategories,
    rules: defaultRules
  });
}
