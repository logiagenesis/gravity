import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".tsbuild",
      "coverage",
      "playwright-report",
      "test-results",
      "src/catalog/generated",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    // The simulation core must stay dependency-free and hot-path clean.
    files: ["src/sim/**/*.ts"],
    rules: { "no-restricted-globals": ["error", "window", "document"] },
  },
  { files: ["scripts/**/*.ts", "tests/**/*.ts"], rules: { "no-console": "off" } },
);
