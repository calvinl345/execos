import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

describe("profile-source installer portability", () => {
  it("does not point profile materialization at the old PowerShell-only script", () => {
    const files = [
      ...new Set(
        matchingLines(/apply-profile\.ps1|\.\\scripts\\install\.ps1/, "Profiles").map(({ file }) => file),
      ),
    ];

    expect(files).toEqual([]);
  });

  it("keeps remaining Windows-specific profile strings explicitly labeled", () => {
    const offenders = matchingLines(/winget|cmd\.exe|powershell|PowerShell|C:\\/, "Profiles")
      .map(({ file, lineNumber, text }) => `${file}:${lineNumber}:${text}`)
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

// Plain Node search, so the suite needs no external tool such as ripgrep.
function matchingLines(pattern, root) {
  const matches = [];
  for (const file of listFiles(root)) {
    const content = readFileSync(file, "utf8");
    if (content.includes("\u0000")) continue; // binary file
    content.split(/\r?\n/).forEach((text, index) => {
      if (pattern.test(text)) matches.push({ file, lineNumber: index + 1, text });
    });
  }
  return matches;
}

function listFiles(root) {
  const out = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      out.push(...listFiles(path));
    } else {
      out.push(path);
    }
  }
  return out;
}
