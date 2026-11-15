import type { EnvKind } from "./types.js";

export const ENV_MEANING: Record<EnvKind, string> = {
  production: "Normal production data. This is the everyday live workspace.",
  development: "Development data. Changes here are for building and validation before production use.",
  "production-sandbox": "Local sandbox data cloned from production for safe inspection and testing.",
  "development-sandbox": "Local sandbox data cloned from development for safe inspection and testing.",
};
