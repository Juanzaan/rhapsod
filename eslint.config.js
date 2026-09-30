import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      ".claude/**",
      "eslint.config.js",
      "scripts/**/*.mjs",
      "scripts/**/*.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    // Panel browser code: classic scripts sharing one global scope per page,
    // with top-level functions called from inline handlers. Undefined names
    // and DOM API misuse are caught by `tsc -p tsconfig.panel.json`.
    files: ["src/panel/scripts/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { sourceType: "script" },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none", vars: "local" },
      ],
    },
  },
);
