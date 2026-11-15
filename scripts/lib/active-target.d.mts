export const TARGET_FILE: string;
export const LIVE_ENV_FILES: {
  development: string;
  production: string;
};
export const SANDBOX_ENV_FILE: string;

export interface SandboxState {
  active: boolean;
  source: string | null;
  clonedAt: string | null;
}

export interface TargetState {
  live: "development" | "production";
  sandbox: SandboxState;
}

export type EnvKind = "production" | "development" | "production-sandbox" | "development-sandbox";

export function targetPath(repoRoot: string): string;
export function readTarget(repoRoot: string): TargetState;
export function writeTarget(repoRoot: string, state: TargetState): void;
export function activeEnvFile(state: TargetState): string;
export function envKind(state: TargetState): EnvKind;
export function describeTarget(state: TargetState): string;
export function isLocalUrl(url: string): boolean;
export function assertSandboxEnvIsLocal(env: Record<string, string | undefined>): void;
