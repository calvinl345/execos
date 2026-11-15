#!/usr/bin/env node

import { runExecosLauncher } from "./execos-launcher.mjs";

runExecosLauncher()
  .then((code) => {
    // Only overwrite on failure: a resolved 0 must not clobber a nonzero
    // process.exitCode already set by a command action (e.g. dashboard
    // status/start/stop report failures via process.exitCode, not throws).
    if (code !== 0) {
      process.exitCode = code;
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
