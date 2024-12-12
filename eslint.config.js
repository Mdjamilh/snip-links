import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules", "coverage", ".vercel", "public/static/htmx.min.js"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { files: ["public/**/*.js"], languageOptions: { globals: globals.browser } },
  { files: ["src/**/*.{ts,tsx}", "test/**/*.ts", "*.ts"], languageOptions: { globals: globals.node } },
);
