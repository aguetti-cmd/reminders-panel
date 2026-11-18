// Calls the helper binary. Pure module, no obsidian import and no Node import.
// The execFile function is injected so tests can run it against a mock helper,
// and so nothing Node-specific is loaded on mobile.

import { HelperError, parseEnvelope } from "./envelope";
import type {
  AccessPair,
  CalEvent,
  EventCreatePayload,
  EventUpdatePayload,
  HelperCommand,
  Reminder,
  ReminderCreatePayload,
  ReminderUpdatePayload,
  RequestAccessPayload,
  Snapshot,
  SnapshotPayload,
  VersionData,
} from "./types";

export interface ExecFileOptions {
  timeout: number;
  maxBuffer: number;
}

export type ExecFileCallback = (
  error: (Error & { code?: unknown; killed?: boolean; signal?: unknown }) | null,
  stdout: string | Buffer,
  stderr: string | Buffer,
) => void;

export type ExecFileFn = (
  file: string,
  args: string[],
  options: ExecFileOptions,
  callback: ExecFileCallback,
) => unknown;

export const EXEC_OPTIONS: ExecFileOptions = { timeout: 20000, maxBuffer: 16 * 1024 * 1024 };
// request-access waits for the user to answer the macOS prompt. The helper waits up to
// 10 minutes, so the plugin must not kill it after 20 seconds.
export const REQUEST_ACCESS_OPTIONS: ExecFileOptions = { ...EXEC_OPTIONS, timeout: 11 * 60 * 1000 };

/** Expands a leading "~" to the home folder. */
export function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return home.replace(/\/+$/, "") + p.slice(1);
  return p;
}

/** Runs async tasks one at a time. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export class HelperBridge {
  private readonly queue = new SerialQueue();

  constructor(
    private readonly execFile: ExecFileFn,
    private helperPath: string,
  ) {}

  setHelperPath(p: string): void {
    this.helperPath = p;
  }

  getHelperPath(): string {
    return this.helperPath;
  }

  call(command: HelperCommand, payload?: object): Promise<unknown> {
    return this.queue.run(() => this.exec(command, payload));
  }

  private exec(command: HelperCommand, payload?: object): Promise<unknown> {
    const args = [command, JSON.stringify(payload ?? {})];
    return new Promise((resolve, reject) => {
      try {
        const options = command === "request-access" ? REQUEST_ACCESS_OPTIONS : EXEC_OPTIONS;
        this.execFile(this.helperPath, args, options, (error, stdout, stderr) => {
          const out = String(stdout ?? "");
          const errText = String(stderr ?? "");
          // The helper exits 1 on ok:false, so always try the envelope first.
          if (out.trim() !== "") {
            try {
              resolve(parseEnvelope(out, errText));
            } catch (e) {
              reject(e);
            }
            return;
          }
          if (error) {
            if (error.code === "ENOENT") {
              reject(new HelperError("internal", `Helper not found at ${this.helperPath}.`));
            } else if (error.code === "EACCES") {
              reject(new HelperError("internal", `Helper is not executable at ${this.helperPath}.`));
            } else if (error.killed || error.signal) {
              reject(new HelperError("internal", "The helper did not answer in time."));
            } else {
              const detail = (errText || error.message).trim().replace(/\s+/g, " ").slice(0, 200);
              reject(new HelperError("internal", `The helper returned no valid answer (${detail}).`));
            }
            return;
          }
          try {
            resolve(parseEnvelope(out, errText));
          } catch (e) {
            reject(e);
          }
        });
      } catch (e) {
        reject(new HelperError("internal", e instanceof Error ? e.message : String(e)));
      }
    });
  }

  async version(): Promise<VersionData> {
    const d = (await this.call("version")) as Partial<VersionData>;
    return {
      helperVersion: typeof d.helperVersion === "string" ? d.helperVersion : "unknown",
      contractVersion: typeof d.contractVersion === "number" ? d.contractVersion : -1,
    };
  }

  async status(): Promise<AccessPair> {
    return (await this.call("status")) as AccessPair;
  }

  async requestAccess(payload: RequestAccessPayload = {}): Promise<AccessPair> {
    return (await this.call("request-access", payload)) as AccessPair;
  }

  async snapshot(payload: SnapshotPayload): Promise<Snapshot> {
    return (await this.call("snapshot", payload)) as Snapshot;
  }

  async reminderCreate(payload: ReminderCreatePayload): Promise<Reminder> {
    return ((await this.call("reminder-create", payload)) as { reminder: Reminder }).reminder;
  }

  async reminderUpdate(payload: ReminderUpdatePayload): Promise<Reminder> {
    return ((await this.call("reminder-update", payload)) as { reminder: Reminder }).reminder;
  }

  async eventCreate(payload: EventCreatePayload): Promise<CalEvent> {
    return ((await this.call("event-create", payload)) as { event: CalEvent }).event;
  }

  async eventUpdate(payload: EventUpdatePayload): Promise<CalEvent> {
    return ((await this.call("event-update", payload)) as { event: CalEvent }).event;
  }
}
