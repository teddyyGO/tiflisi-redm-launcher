// Self-update from GitHub Releases (electron-updater, configured by "build.publish" in package.json).
// New versions download quietly in the background (only the changed blocks); the player clicks once
// and the app restarts into the new version with a silent install, no installer window.
const { app, ipcMain } = require("electron")
const { autoUpdater } = require("electron-updater")

let win = null
// idle | checking | downloading | ready | latest | error | dev
let state = { state: "idle", current: app.getVersion() }

function push(next) {
  state = { ...state, ...next }
  if (win && !win.isDestroyed()) win.webContents.send("update-state", state)
}

// GitHub release notes arrive as HTML; the launcher shows a short plain-text summary.
function notesText(n) {
  const raw = Array.isArray(n) ? n.map((x) => x.note || "").join("\n") : String(n || "")
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 280)
}

function check() {
  if (!app.isPackaged) return push({ state: "dev" })
  autoUpdater.checkForUpdates().catch((e) => push({ state: "error", message: String(e && e.message || e).slice(0, 200) }))
}

function init(window) {
  win = window
  if (!app.isPackaged) { state.state = "dev"; return } // updates only exist for the installed app
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // never clicked? it installs the next time the launcher closes
  autoUpdater.on("checking-for-update", () => { if (state.state !== "ready") push({ state: "checking" }) })
  autoUpdater.on("update-available", (i) => push({ state: "downloading", version: i.version, percent: 0 }))
  autoUpdater.on("update-not-available", () => push({ state: "latest" }))
  autoUpdater.on("download-progress", (p) => push({ state: "downloading", percent: Math.round(p.percent || 0) }))
  autoUpdater.on("update-downloaded", (i) => push({ state: "ready", version: i.version, notes: notesText(i.releaseNotes) }))
  autoUpdater.on("error", (e) => { if (state.state !== "ready") push({ state: "error", message: String(e && e.message || e).slice(0, 200) }) })
  check()
  setInterval(check, 30 * 60 * 1000)
}

ipcMain.handle("update-state", () => state)
ipcMain.handle("update-check", () => { check(); return state })
// isSilent = true (no installer UI), isForceRunAfter = true (reopen the launcher afterwards).
ipcMain.handle("update-install", () => { if (state.state === "ready") setImmediate(() => autoUpdater.quitAndInstall(true, true)) })

module.exports = { init }
