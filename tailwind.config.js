export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      colors: {
        ledger: {
          blue: "#2563eb",
          green: "#16a34a",
          red: "#dc2626",
          ink: "#111827"
        }
      }
    }
  },
  plugins: []
};
