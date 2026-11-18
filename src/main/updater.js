// Self-update from GitHub Releases (electron-updater, configured by "build.publish" in package.json).
// New versions download quietly in the background (only the changed blocks); the player clicks once
// and the app restarts into the new version with a silent install, no installer window.
const { app, ipcMain } = require("electron")
const { autoUpdater } = require("electron-updater")
const fs = require("fs")
const path = require("path")

const CHECK_EVERY = 10 * 60 * 1000 // regular check
const RETRY_AFTER_ERROR = 2 * 60 * 1000 // e.g. a release whose files are still uploading
const FOCUS_MIN_GAP = 5 * 60 * 1000 // bringing the window to the front checks, at most this often

let win = null
let lastCheck = 0
let retryTimer = null
// idle | checking | downloading | ready | latest | error | dev
let state = { state: "idle", current: app.getVersion() }

// Small log players can send to staff: %APPDATA%\<app>\updater.log (trimmed at 200 KB).
const logFile = path.join(app.getPath("userData"), "updater.log")
function log(level, msg) {
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 200 * 1024) fs.writeFileSync(logFile, "")
    fs.appendFileSync(logFile, new Date().toISOString() + " " + level + " " + String(msg).replace(/\s+/g, " ").slice(0, 500) + "\n")
  } catch (e) {}
}

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
  if (state.state === "ready" || state.state === "downloading") return
  lastCheck = Date.now()
  clearTimeout(retryTimer)
  autoUpdater.checkForUpdates().catch(() => {}) // failures arrive through the "error" event
}

function init(window) {
  win = window
  if (!app.isPackaged) { state.state = "dev"; return } // updates only exist for the installed app
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // never clicked? it installs the next time the launcher closes
  autoUpdater.logger = { info: (m) => log("info", m), warn: (m) => log("warn", m), error: (m) => log("error", m), debug: () => {} }
  autoUpdater.on("checking-for-update", () => push({ state: "checking" }))
  autoUpdater.on("update-available", (i) => push({ state: "downloading", version: i.version, percent: 0 }))
  autoUpdater.on("update-not-available", () => push({ state: "latest" }))
  autoUpdater.on("download-progress", (p) => push({ state: "downloading", percent: Math.round(p.percent || 0) }))
  autoUpdater.on("update-downloaded", (i) => push({ state: "ready", version: i.version, notes: notesText(i.releaseNotes) }))
  autoUpdater.on("error", (e) => {
    if (state.state === "ready") return
    push({ state: "error", message: String(e && e.message || e).slice(0, 200) })
    clearTimeout(retryTimer)
    retryTimer = setTimeout(check, RETRY_AFTER_ERROR) // don't wait a full cycle after a hiccup
  })
  win.on("focus", () => { if (Date.now() - lastCheck > FOCUS_MIN_GAP) check() })
  log("info", "launcher " + app.getVersion() + " started")
  check()
  setInterval(check, CHECK_EVERY)
}

ipcMain.handle("update-state", () => state)
ipcMain.handle("update-check", () => { check(); return state })
// isSilent = true (no installer UI), isForceRunAfter = true (reopen the launcher afterwards).
ipcMain.handle("update-install", () => { if (state.state === "ready") setImmediate(() => autoUpdater.quitAndInstall(true, true)) })

module.exports = { init }
