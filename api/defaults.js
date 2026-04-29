import { defaultCategories, defaultRules } from "./app.js";

export default function handler(_request, response) {
  response.status(200).json({
    categories: defaultCategories,
    rules: defaultRules
  });
}
