// Smoke check for the built main.js, for local development only.
// Loads main.js with a stub "obsidian" module and with Node builtins blocked,
// as on iPhone, then runs onload in view mode with a fake vault adapter.
// With SMOKE_EDIT=1 it simulates macOS desktop instead, uses dev/mock-helper.mjs as the
// helper and checks edit mode, the snapshot write, write gating and a real write.
// It does not render any UI. Run after "npm run build": node dev/smoke-mobile.cjs

const Module = require("module");
const path = require("path");

const blocked = new Set(["child_process", "fs", "os", "path", "electron"]);
const EDIT = process.env.SMOKE_EDIT === "1";
let blockNode = !EDIT;

class Component {
  register() {}
  registerEvent() {}
  registerDomEvent() {}
  registerInterval(id) {
    return id;
  }
}
const stub = {
  Platform: EDIT ? { isDesktopApp: true, isMacOS: true, isMobile: false } : { isDesktopApp: false, isMacOS: false, isMobile: true },
  Plugin: class extends Component {
    constructor(app, manifest) {
      super();
      this.app = app;
      this.manifest = manifest;
      this.data = null;
    }
    async loadData() {
      return this.data;
    }
    async saveData(d) {
      this.data = d;
    }
    registerView() {}
    addRibbonIcon() {}
    addSettingTab() {}
    addCommand(c) {
      (this.commands = this.commands || []).push(c.id);
    }
  },
  ItemView: class extends Component {},
  Modal: class {},
  PluginSettingTab: class {},
  Setting: class {},
  Menu: class {},
  Notice: class {
    constructor(msg) {
      console.log("Notice:", msg);
    }
  },
  setIcon() {},
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const name = request.replace(/^node:/, "");
  if (request === "obsidian") return stub;
  if (blockNode && blocked.has(name) && parent && parent.filename && parent.filename.endsWith("main.js")) {
    throw new Error(`main.js required "${request}" on a simulated mobile device`);
  }
  return origLoad.apply(this, arguments);
};

globalThis.window = globalThis;
globalThis.document = { visibilityState: "visible" };

const snapshotFile = {
  schemaVersion: 1,
  writtenAt: new Date(Date.now() - 5 * 60000).toISOString(),
  writtenBy: "Test Mac",
  snapshot: {
    generatedAt: "2026-11-18T09:00:00+07:00",
    timeZone: "Asia/Bangkok",
    daysAhead: 7,
    access: { reminders: "fullAccess", events: "fullAccess" },
    lists: [],
    reminders: [],
    calendars: [],
    events: [],
  },
};

const files = new Map([[".obsidian/plugins/reminders-panel/snapshot.json", JSON.stringify(snapshotFile)]]);
const writes = [];
const adapter = {
  exists: async (p) => files.has(p),
  read: async (p) => files.get(p),
  write: async (p, d) => {
    writes.push(p);
    files.set(p, d);
  },
  mkdir: async () => {},
};
let layoutReady;
const app = {
  vault: { adapter, configDir: ".obsidian", getName: () => "Vault" },
  workspace: {
    onLayoutReady: (cb) => (layoutReady = cb),
    getLeavesOfType: () => [{}],
    getActiveFile: () => null,
  },
};

(async () => {
  const mod = require(path.resolve(__dirname, "../main.js"));
  const Plugin = mod.default;
  const plugin = new Plugin(app, { id: "reminders-panel" });
  if (EDIT) {
    process.env.REMINDERS_MOCK_STATE = path.join(require("os").tmpdir(), "rp-smoke-" + process.pid + ".json");
    plugin.data = { helperPath: path.resolve(__dirname, "mock-helper.mjs"), deviceLabel: "Smoke Mac" };
  }
  await plugin.onload();
  if (EDIT) {
    layoutReady();
    await new Promise((r) => setTimeout(r, 1500));
    const s = plugin.state;
    console.log("mode:", s.mode, "helper:", s.helperVersion, "reminders:", s.snapshot && s.snapshot.reminders.length, "writes:", writes.length);
    const written = JSON.parse(files.get(".obsidian/plugins/reminders-panel/snapshot.json"));
    const blocked = await plugin.runWrite("reminder-create", { title: "Smoke" });
    plugin.settings.reminderWriteback = true;
    const dry = await plugin.runWrite("reminder-create", { title: "Smoke" });
    plugin.settings.dryRun = false;
    const before = s.snapshot.reminders.length;
    const sent = await plugin.runWrite("reminder-create", { title: "Smoke" });
    const after = plugin.state.snapshot.reminders.length;
    console.log("outcomes:", blocked, dry, sent, "log:", plugin.dryRunLog.size, "count:", before, "->", after, "writes:", writes.length);
    plugin.onunload();
    require("fs").rmSync(process.env.REMINDERS_MOCK_STATE, { force: true });
    const ok = s.mode === "edit" && written.writtenBy === "Smoke Mac" && blocked === "blocked" && dry === "dryRun" && sent === "sent" && after === before + 1 && writes.length === 2;
    console.log(ok ? "Edit smoke check passed" : "Edit smoke check failed");
    process.exit(ok ? 0 : 1);
  }
  layoutReady();
  await new Promise((r) => setTimeout(r, 50));
  const s = plugin.state;
  const ok = s.ready && s.mode === "view" && s.writtenBy === "Test Mac" && s.snapshot && writes.length === 0;
  console.log("commands:", plugin.commands.join(", "));
  console.log("mode:", s.mode, "writtenBy:", s.writtenBy, "emptyReason:", s.emptyReason, "writes:", writes.length);
  plugin.onunload();
  if (!ok) {
    console.error("Smoke check failed");
    process.exit(1);
  }
  console.log("Smoke check passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
