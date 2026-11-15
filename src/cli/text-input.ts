import { readFile } from "node:fs/promises";
import { InputValidationError } from "./errors.js";

interface TextInputRuntime {
  readFileText: (path: string) => Promise<string>;
  readStdinText: () => Promise<string>;
  stdinIsTty: () => boolean;
}

interface ResolveTextInputArgs {
  inline: string | undefined;
  file?: string | undefined;
  inlineName: string;
  fileName?: string;
}

let runtimeOverride: Partial<TextInputRuntime> | null = null;

export function setTextInputRuntimeForTests(
  runtime: Partial<TextInputRuntime> | null,
): () => void {
  const previous = runtimeOverride;
  runtimeOverride = runtime;
  return () => {
    runtimeOverride = previous;
  };
}

export class TextInputResolver {
  private stdinField: string | null = null;
  private stdinCache: string | null = null;

  async resolve(args: ResolveTextInputArgs): Promise<string | undefined> {
    if (args.inline !== undefined && args.file !== undefined) {
      throw new InputValidationError(
        `Cannot use ${args.inlineName} and ${args.fileName ?? "file input"} together; choose one.`,
      );
    }

    if (args.inline === undefined && args.file === undefined) return undefined;

    const selectedName = args.file !== undefined
      ? args.fileName ?? "file input"
      : args.inlineName;
    const selectedValue = args.file !== undefined ? args.file : args.inline;

    if (selectedValue !== "-") {
      if (args.file !== undefined) {
        return await this.readFileInput(args.file, selectedName);
      }
      return selectedValue;
    }

    return await this.readStdinInput(selectedName, args.inlineName);
  }

  private async readFileInput(path: string, flagName: string): Promise<string> {
    try {
      return (await runtime().readFileText(path)).replace(/^\uFEFF/, "");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new InputValidationError(
        `Could not read ${flagName} path '${path}': ${message}`,
      );
    }
  }

  private async readStdinInput(
    flagName: string,
    inlineName: string,
  ): Promise<string> {
    if (this.stdinField && this.stdinField !== flagName) {
      throw new InputValidationError(
        `Cannot read stdin for both ${this.stdinField} and ${flagName}; pass one value inline or with a file.`,
      );
    }
    this.stdinField = flagName;

    if (runtime().stdinIsTty()) {
      throw new InputValidationError(
        `${flagName} - requires piped input; pass ${inlineName} "text" for inline use.`,
      );
    }

    if (this.stdinCache === null) {
      this.stdinCache = stripTrailingNewlines(await runtime().readStdinText());
    }
    return this.stdinCache;
  }
}

function runtime(): TextInputRuntime {
  return {
    readFileText: runtimeOverride?.readFileText
      ?? ((path) => readFile(path, "utf8")),
    readStdinText: runtimeOverride?.readStdinText ?? readProcessStdin,
    stdinIsTty: runtimeOverride?.stdinIsTty
      ?? (() => process.stdin.isTTY === true),
  };
}

async function readProcessStdin(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) {
    text += String(chunk);
  }
  return text;
}

function stripTrailingNewlines(value: string): string {
  return value.replace(/(?:\r\n|\n|\r)+$/, "");
}
