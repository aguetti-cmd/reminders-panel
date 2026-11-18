import { describe, expect, it } from "vitest";
import { describeError, HelperError, parseEnvelope } from "../src/envelope";
import { expandHome, HelperBridge, SerialQueue, type ExecFileFn } from "../src/bridge";

function catchErr(fn: () => unknown): HelperError {
  try {
    fn();
  } catch (e) {
    if (e instanceof HelperError) return e;
    throw e;
  }
  throw new Error("expected a throw");
}

describe("parseEnvelope", () => {
  it("returns data on success", () => {
    expect(parseEnvelope('{"ok":true,"data":{"a":1}}\n')).toEqual({ a: 1 });
  });

  it("throws a typed error for an error envelope", () => {
    const e = catchErr(() => parseEnvelope('{"ok":false,"error":{"code":"read_only","message":"List is read only."}}'));
    expect(e.code).toBe("read_only");
    expect(e.message).toBe("List is read only.");
    expect(describeError(e)).toBe("Read only: List is read only.");
  });

  it("maps an unknown error code to internal", () => {
    const e = catchErr(() => parseEnvelope('{"ok":false,"error":{"code":"weird","message":"x"}}'));
    expect(e.code).toBe("internal");
  });

  it("turns garbage into internal with a piece of stderr", () => {
    const e = catchErr(() => parseEnvelope("Segmentation fault", "dyld: Library not loaded"));
    expect(e.code).toBe("internal");
    expect(e.message).toContain("dyld: Library not loaded");
  });

  it("rejects JSON that is not an envelope", () => {
    expect(catchErr(() => parseEnvelope("[1,2]")).code).toBe("internal");
    expect(catchErr(() => parseEnvelope('{"data":{}}')).code).toBe("internal");
    expect(catchErr(() => parseEnvelope("")).code).toBe("internal");
  });
});

describe("expandHome", () => {
  it("expands a leading tilde only", () => {
    expect(expandHome("~/Library/x", "/Users/a")).toBe("/Users/a/Library/x");
    expect(expandHome("~", "/Users/a")).toBe("/Users/a");
    expect(expandHome("/opt/~/x", "/Users/a")).toBe("/opt/~/x");
    expect(expandHome("~bob/x", "/Users/a")).toBe("~bob/x");
  });
});

describe("HelperBridge with a fake execFile", () => {
  it("passes command and JSON payload as two arguments with the contract options", async () => {
    const calls: { file: string; args: string[]; opts: unknown }[] = [];
    const fake: ExecFileFn = (file, args, opts, cb) => {
      calls.push({ file, args, opts });
      cb(null, '{"ok":true,"data":{"helperVersion":"1","contractVersion":1}}\n', "");
    };
    const b = new HelperBridge(fake, "/h");
    await b.version();
    await b.snapshot({ daysAhead: 3 });
    expect(calls[0]).toEqual({ file: "/h", args: ["version", "{}"], opts: { timeout: 20000, maxBuffer: 16 * 1024 * 1024 } });
    expect(calls[1].args).toEqual(["snapshot", '{"daysAhead":3}']);
  });

  it("gives request-access a long timeout so the user can answer the prompt", async () => {
    const opts: unknown[] = [];
    const fake: ExecFileFn = (_f, _a, o, cb) => {
      opts.push(o);
      cb(null, '{"ok":true,"data":{"reminders":"fullAccess","events":"fullAccess"}}', "");
    };
    await new HelperBridge(fake, "/h").requestAccess({ reminders: true, events: true });
    expect(opts[0]).toEqual({ timeout: 11 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
  });

  it("parses stdout even when execFile reports exit code 1", async () => {
    const fake: ExecFileFn = (_f, _a, _o, cb) =>
      cb(Object.assign(new Error("Command failed"), { code: 1 }), '{"ok":false,"error":{"code":"not_found","message":"No such reminder."}}\n', "");
    const b = new HelperBridge(fake, "/h");
    await expect(b.reminderUpdate({ id: "x" })).rejects.toMatchObject({ code: "not_found", message: "No such reminder." });
  });

  it("reports a missing helper and a timeout as internal", async () => {
    const missing: ExecFileFn = (_f, _a, _o, cb) => cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }), "", "");
    await expect(new HelperBridge(missing, "/nope").version()).rejects.toMatchObject({ code: "internal" });
    const slow: ExecFileFn = (_f, _a, _o, cb) => cb(Object.assign(new Error("killed"), { killed: true, signal: "SIGTERM" }), "", "");
    await expect(new HelperBridge(slow, "/h").version()).rejects.toMatchObject({ code: "internal", message: "The helper did not answer in time." });
  });

  it("runs calls one at a time", async () => {
    let running = 0;
    let maxRunning = 0;
    const fake: ExecFileFn = (_f, _a, _o, cb) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      setTimeout(() => {
        running--;
        cb(null, '{"ok":true,"data":{}}', "");
      }, 5);
    };
    const b = new HelperBridge(fake, "/h");
    await Promise.all([b.call("status"), b.call("status"), b.call("status")]);
    expect(maxRunning).toBe(1);
  });

  it("keeps the queue going after a failure", async () => {
    const q = new SerialQueue();
    const order: string[] = [];
    const a = q.run(async () => {
      order.push("a");
      throw new Error("boom");
    });
    const b = q.run(async () => {
      order.push("b");
      return 2;
    });
    await expect(a).rejects.toThrow("boom");
    await expect(b).resolves.toBe(2);
    expect(order).toEqual(["a", "b"]);
  });
});
