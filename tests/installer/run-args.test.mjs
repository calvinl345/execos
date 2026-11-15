import { parseArgs } from "../../scripts/installer/run.mjs";

describe("Linux installer runner arguments", () => {
  it("normalizes the locked argv contract", () => {
    expect(
      parseArgs([
        "--profile",
        "developer",
        "--db-environment",
        "production",
        "--skip-install",
        "--skip-build",
        "--skip-database",
        "--use-existing-credentials",
        "--no-clear-screen",
        "--repo-root",
        ".",
      ]),
    ).toMatchObject({
      profile: "developer",
      dbEnvironment: "production",
      skipInstall: true,
      skipBuild: true,
      skipDatabase: true,
      useExistingCredentials: true,
      noClearScreen: true,
    });
  });

  it("defaults developer installs to development DB and production installs to production DB", () => {
    expect(parseArgs(["--profile", "developer"]).dbEnvironment).toBe("development");
    expect(parseArgs(["--profile", "production"]).dbEnvironment).toBe("production");
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--wat"])).toThrow("Unknown option");
  });
});
