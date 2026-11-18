// Write gating, the dry-run log and mode decision. Pure module, no obsidian import.

import { CONTRACT_VERSION, type Mode, type WriteCommand } from "./types";

export interface GateSettings {
  reminderWriteback: boolean;
  calendarWriteback: boolean;
  dryRun: boolean;
}

export type GateDecision =
  | { action: "send" }
  | { action: "dryRun"; notice: string }
  | { action: "blocked"; reason: string };

export function commandKind(command: WriteCommand): "reminder" | "event" {
  return command.startsWith("reminder-") ? "reminder" : "event";
}

/** True when write controls for this kind should be shown. */
export function canWrite(mode: Mode, kind: "reminder" | "event", s: GateSettings): boolean {
  if (mode !== "edit") return false;
  return kind === "reminder" ? s.reminderWriteback : s.calendarWriteback;
}

/** Decides what happens to a write. Blocked in view mode or with the setting off. Dry run never calls the helper. */
export function gateWrite(mode: Mode, command: WriteCommand, payload: object, s: GateSettings): GateDecision {
  const kind = commandKind(command);
  if (mode !== "edit") return { action: "blocked", reason: "View only on this device." };
  if (kind === "reminder" && !s.reminderWriteback) {
    return { action: "blocked", reason: "Reminder changes are off in settings." };
  }
  if (kind === "event" && !s.calendarWriteback) {
    return { action: "blocked", reason: "Calendar changes are off in settings." };
  }
  if (s.dryRun) {
    return { action: "dryRun", notice: `Dry run: would send ${command} ${JSON.stringify(payload)}` };
  }
  return { action: "send" };
}

export interface DryRunEntry {
  at: string;
  command: WriteCommand;
  payload: object;
}

export const DRY_RUN_LOG_MAX = 50;

export class DryRunLog {
  private entries: DryRunEntry[] = [];
  add(command: WriteCommand, payload: object, now: Date = new Date()): void {
    this.entries.push({ at: now.toISOString(), command, payload });
    if (this.entries.length > DRY_RUN_LOG_MAX) this.entries.splice(0, this.entries.length - DRY_RUN_LOG_MAX);
  }
  /** Newest first. */
  list(): DryRunEntry[] {
    return [...this.entries].reverse();
  }
  clear(): void {
    this.entries = [];
  }
  get size(): number {
    return this.entries.length;
  }
}

export interface ModeInput {
  isDesktopApp: boolean;
  isMacOS: boolean;
  helperExists: boolean;
  /** null when version was not called or failed. */
  contractVersion: number | null;
}

export interface ModeDecision {
  mode: Mode;
  /** A setup hint for the panel, only on macOS desktop. */
  hint: string | null;
}

export function decideMode(i: ModeInput, helperPath: string): ModeDecision {
  if (!i.isDesktopApp || !i.isMacOS) return { mode: "view", hint: null };
  if (!i.helperExists) {
    return { mode: "view", hint: `Helper not found at ${helperPath}. Install it or fix the path in settings.` };
  }
  if (i.contractVersion === null) {
    return { mode: "view", hint: `The helper at ${helperPath} did not answer. Check that it runs.` };
  }
  if (i.contractVersion !== CONTRACT_VERSION) {
    return {
      mode: "view",
      hint: `The helper at ${helperPath} uses contract version ${i.contractVersion}, but this plugin needs ${CONTRACT_VERSION}.`,
    };
  }
  return { mode: "edit", hint: null };
}
