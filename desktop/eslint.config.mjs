import js from "@eslint/js";
import globals from "globals";

/**
 * The scripts and tests, which no type checker reads. The page's TypeScript is checked by
 * `tsc --noEmit`, strict and with unused names refused: typescript-eslint does not read
 * TypeScript 7.
 */
export default [
  { ignores: ["dist/**", "src-tauri/target/**", "src-tauri/gen/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      // A test's functions run in the page, so browser names are as good as Node's.
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
