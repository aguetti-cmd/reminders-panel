// Parses the helper's JSON envelope (contract section 3). Pure module, no obsidian import.

import { HELPER_ERROR_CODES, type HelperErrorCode } from "./types";

export class HelperError extends Error {
  readonly code: HelperErrorCode;
  constructor(code: HelperErrorCode, message: string) {
    super(message);
    this.name = "HelperError";
    this.code = code;
  }
}

function shortText(s: string, max = 200): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) + "..." : t;
}

/**
 * Parses helper stdout. Returns `data` on success, throws HelperError otherwise.
 * Output that is not a valid envelope becomes code "internal" with a short piece of stderr.
 */
export function parseEnvelope(stdout: string, stderr = ""): unknown {
  const text = stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const detail = shortText(stderr) || (text === "" ? "no output" : "output was not JSON");
    throw new HelperError("internal", `The helper returned no valid answer (${detail}).`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HelperError("internal", "The helper answer was not a JSON object.");
  }
  const env = parsed as Record<string, unknown>;
  if (env.ok === true) {
    return env.data ?? {};
  }
  if (env.ok === false) {
    const err = env.error as Record<string, unknown> | undefined;
    const rawCode = err && typeof err.code === "string" ? err.code : "internal";
    const code = (HELPER_ERROR_CODES as readonly string[]).includes(rawCode)
      ? (rawCode as HelperErrorCode)
      : "internal";
    const message = err && typeof err.message === "string" && err.message !== "" ? err.message : "Unknown error.";
    throw new HelperError(code, message);
  }
  throw new HelperError("internal", "The helper answer had no ok field.");
}

const CODE_LABELS: Record<HelperErrorCode, string> = {
  invalid_input: "Invalid input",
  access_denied: "No access",
  access_not_determined: "Access not granted yet",
  not_found: "Not found",
  read_only: "Read only",
  unsupported_os: "macOS too old",
  internal: "Helper error",
};

/** Short text for a Notice. */
export function describeError(err: unknown): string {
  if (err instanceof HelperError) return `${CODE_LABELS[err.code]}: ${err.message}`;
  if (err instanceof Error) return `Error: ${err.message}`;
  return "Something went wrong.";
}
