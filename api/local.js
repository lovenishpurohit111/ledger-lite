import { createApp } from "./app.js";

const port = process.env.PORT || 3001;

createApp().listen(port, () => {
  console.log(`LedgerLite API running on http://localhost:${port}/api`);
});
