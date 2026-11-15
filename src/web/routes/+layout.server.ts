import type { LayoutServerLoad } from "./$types";
import { buildEnvInfo } from "../lib/server/env-info.js";

export const load: LayoutServerLoad = () => {
  return {
    targetLabel: process.env.EXECOS_TARGET_LABEL ?? "LIVE PRODUCTION",
    envInfo: buildEnvInfo(),
    demoMode: process.env.EXECOS_DEMO_MODE === "1",
  };
};
