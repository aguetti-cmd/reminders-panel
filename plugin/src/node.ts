// Desktop-only access to Node modules.
// Mobile Obsidian has no Node. Every require() here runs at call time, never at load time,
// and callers must only call these functions when Platform.isDesktopApp is true.

import type { ExecFileFn } from "./bridge";

export function nodeExecFile(): ExecFileFn {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require("child_process") as typeof import("child_process");
  return (file, args, options, callback) =>
    cp.execFile(file, args, { timeout: options.timeout, maxBuffer: options.maxBuffer, encoding: "utf8" }, callback);
}

export function nodeHomedir(): string {
  const os = require("os") as typeof import("os");
  return os.homedir();
}

export function nodeHostname(): string {
  const os = require("os") as typeof import("os");
  return os.hostname();
}

/** True when a regular file exists at an absolute path. */
export function nodeFileExists(absPath: string): boolean {
  const fs = require("fs") as typeof import("fs");
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}
