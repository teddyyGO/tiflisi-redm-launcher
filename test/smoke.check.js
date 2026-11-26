// Smoke test: starts the real launcher (main.js + the page) on the installed Electron, then fails on any
// page error or main-process exception and checks the read-only IPC calls answer. Catches a broken
// Electron upgrade or a handler whose arguments no longer match its module.
// Offline and isolated: network calls are stubbed (no heartbeat reaches the live server) and the
// profile lives in a temp folder. Run: electron test/smoke.check.js
const { app, BrowserWindow } = require("electron")
const fs = require("fs")
const os = require("os")
const path = require("path")

const errors = []
process.on("uncaughtException", (e) => errors.push("main: " + (e.stack || e)))
process.on("unhandledRejection", (e) => errors.push("main (promise): " + (e && e.stack || e)))
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "launcher-smoke-")))
globalThis.fetch = async () => { throw new Error("offline (smoke test)") }

const finish = () => {
  if (errors.length) { console.error("smoke FAILED:\n" + errors.join("\n")); app.exit(1) }
  else { console.log("smoke ok"); app.exit(0) }
}
setTimeout(() => { errors.push("timed out"); finish() }, 30000)

app.on("browser-window-created", (_, win) => {
  // Crashes, CSP refusals and a failed init. Not the page's own logged network failures (offline here,
  // or a config.local.json panel API that's down).
  const bad = /^(Uncaught|Init error)|Refused to|Content Security Policy/
  win.webContents.on("console-message", (e) => { if (e.level === "error" && bad.test(e.message)) errors.push("page: " + e.message) })
  win.webContents.once("did-finish-load", () => setTimeout(async () => {
    try {
      const r = await win.webContents.executeJavaScript(`(async () => {
        const l = window.launcher
        const [cfg, ver, ready, info, gfx, meta, upd, name, chg, pc, build] = await Promise.all([l.getConfig(), l.getVersion(),
          l.readiness(), l.redmInfo(), l.graphicsInfo(), l.cleanupMeta(), l.updateState(), l.getName(), l.changesInfo(), l.pcInfo(), l.buildInfo()])
        return { cfg: !!cfg.brand, ver, ready: typeof ready.redm, info: typeof info.channel, gfx: typeof gfx.exes,
          meta: meta.length, upd: upd.state, name: typeof name.name, joinBtn: !!document.getElementById("join-btn").textContent.trim(),
          devLink: !document.getElementById("dev-join").hidden,
          hooks: Array.isArray(ready.hooks), win: typeof gfx.windows.gameMode, power: typeof gfx.power,
          chg: Array.isArray(chg.modBackups), pc: typeof pc.threads, build: build === null || typeof build.commit }
      })()`)
      const want = { cfg: true, ver: app.getVersion(), ready: "boolean", info: "string", gfx: "number", meta: 7, upd: "dev", name: "string", joinBtn: true, devLink: true,
        hooks: true, win: "boolean", power: "string", chg: true, pc: "number", build: true }
      for (const k in want) if (r[k] !== want[k]) errors.push(`ipc ${k}: got ${JSON.stringify(r[k])}, want ${JSON.stringify(want[k])}`)
    } catch (e) {
      errors.push("ipc: " + e.message)
    }
    finish()
  }, 3000))
})

require("../src/main/main.js")
