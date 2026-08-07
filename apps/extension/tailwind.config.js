/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/popup/index.html",
    "./src/popup/**/*.{js,ts,jsx,tsx}",
    "../../packages/ui/src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          pink: "#ff007f",
          purple: "#8b5cf6",
          cyan: "#00f0ff",
          dark: "#060814",
          card: "#0f172a",
          border: "#1e293b"
        }
      }
    },
  },
  plugins: [],
}
