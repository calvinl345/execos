import { execFileSync } from "node:child_process";

describe("profile-source installer portability", () => {
  it("does not point profile materialization at the old PowerShell-only script", () => {
    const files = rg(["-l", "apply-profile\\.ps1|\\.\\\\scripts\\\\install\\.ps1", "Profiles"]);

    expect(files).toEqual([]);
  });

  it("keeps remaining Windows-specific profile strings explicitly labeled", () => {
    const offenders = rg(["-n", "winget|cmd\\.exe|powershell|PowerShell|C:\\\\", "Profiles"])
      .filter(Boolean)
      .filter((line) => {
        const text = line.toLowerCase();
        return !(
          text.includes("windows") ||
          text.includes("powershell") ||
          text.includes("validator") ||
          text.includes("quick_validate.py")
        );
      });

    expect(offenders).toEqual([]);
  });
});

function rg(args) {
  try {
    return execFileSync("rg", args, { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}
