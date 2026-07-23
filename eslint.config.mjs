import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [".claude/**", ".next/**", "node_modules/**", "drizzle/**", "scripts/scratch/**"],
  },
];

export default eslintConfig;
