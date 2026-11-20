const { app, BrowserWindow, shell, ipcMain, clipboard, session } = require("electron")
const path = require("path")
const fs = require("fs")
const net = require("net")
const crypto = require("crypto")
const { exec, spawn } = require("child_process")
const rpc = require("./discord-rpc")
const cleanup = require("./cleanup")
const graphics = require("./graphics")
const updater = require("./updater")
const crash = require("./crash")
const shortcuts = require("./shortcuts")
const nickname = require("./nickname")
const mods = require("./mods")

// Same id the installer gives its shortcuts (build.appId): keeps taskbar pins, grouping and
// Windows notifications tied to this app.
const APP_ID = "io.github.openredmlauncher"
app.setAppUserModelId(APP_ID)

let mainWindow = null

const configPath = path.join(__dirname, "..", "..", "config.json")
let config = { apiUrl: "", slug: "", brand: {} }
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"))
} catch (e) {
  console.error("Config load error:", e)
}
// Optional, git-ignored config.local.json: your own server's settings on top of the public defaults.
try {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config.local.json"), "utf8"))
  config = { ...config, ...local, brand: { ...(config.brand || {}), ...(local.brand || {}) } }
} catch (e) {
  if (e.code !== "ENOENT") console.error("config.local.json:", e.message)
}

// Random per-install id: lets the server-side `launcher_check` resource tell launcher joins apart.
const idFile = path.join(app.getPath("userData"), "launcher-id")
let launcherId
try { launcherId = fs.readFileSync(idFile, "utf8").trim() } catch (e) {}
if (!launcherId) {
  launcherId = crypto.randomUUID()
  try { fs.mkdirSync(path.dirname(idFile), { recursive: true }); fs.writeFileSync(idFile, launcherId) } catch (e) {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    resizable: true,
    backgroundColor: "#15110f",
    icon: path.join(__dirname, "..", "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, // the page can't reach Node or Electron internals
      nodeIntegration: false,
      sandbox: true, // renderer runs in Chromium's OS sandbox
    },
  })
  // The window only ever shows the launcher itself: no pop-ups, no navigating away.
  // Web links (news, Discord) open in the player's real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url)
    return { action: "deny" }
  })
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault())
  // A GPU driver reset (common while RedM crashes) can kill the page: reload instead of a blank window.
  // At most once per 10 s, so a page that dies on load doesn't loop.
  let reloadedAt = 0
  mainWindow.webContents.on("render-process-gone", (_, d) => {
    if (d.reason === "clean-exit" || Date.now() - reloadedAt < 10000) return
    reloadedAt = Date.now()
    mainWindow.reload()
  })
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"))
  updater.init(mainWindow)
}

// One launcher at a time: a second launch focuses the open window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
  app.whenReady().then(() => {
    // The CSP has to allow file: for the launcher's own files, which also matches file://server/share.
    // Windows opens those over SMB and sends the player's login hash, so block any file URL with a host.
    session.defaultSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: d.url.startsWith("file:") && new URL(d.url).host !== "" }))
    // Notifications only (update and crash toasts). Electron grants everything else (camera, mic, location...) by default.
    session.defaultSession.setPermissionRequestHandler((_, permission, cb) => cb(permission === "notifications"))
    createWindow()
    if (config.discordClientId) rpc.start(config.discordClientId)
    if (app.isPackaged && process.platform === "win32") {
      try {
        const appData = app.getPath("appData")
        const fixed = shortcuts.ensure({
          shell,
          exe: process.execPath,
          appId: APP_ID,
          startMenuDir: path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
          desktopDir: app.getPath("desktop"),
          pinnedDir: path.join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar"),
          oldNames: ["RedM Launcher"], // the name before 1.1.1
          stateFile: path.join(app.getPath("userData"), "shortcuts.json"),
        })
        if (fixed.length) console.log("shortcuts:", fixed.join(", "))
      } catch (e) {
        console.error("shortcuts:", e.message)
      }
    }
  })
}
app.on("window-all-closed", () => app.quit())

ipcMain.handle("get-config", () => config)
ipcMain.handle("minimize-window", () => mainWindow?.minimize())
ipcMain.handle("maximize-window", () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()
})
ipcMain.handle("close-window", () => mainWindow?.close())
// The page only opens web links. Game links (redm://) go through join-server, so injected text can't connect RedM anywhere.
ipcMain.handle("open-external", (_, url) => {
  if (/^https:\/\//i.test(String(url))) return shell.openExternal(url)
})
ipcMain.handle("set-auto-start", (_, enabled) => {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  return { success: true }
})
ipcMain.handle("get-app-version", () => app.getVersion())

// ── Server lookup (Cfx list + the server's own /info.json etc.) ──

const IP_PORT = /^[\w.-]+:\d+$/

// Accepts cfx.re/join/abc123, abc123, redm://connect/..., https://..., or ip:port.
function normalise(a) {
  a = String(a || "").trim().replace(/^(https?|redm|fivem):\/\/(connect\/)?/i, "").replace(/\/+$/, "")
  return /^[a-z0-9]{6,8}$/i.test(a) ? "cfx.re/join/" + a.toLowerCase() : a
}

async function getJson(url, ms) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms || 4000) })
    return r.ok ? await r.json() : null
  } catch (e) {
    return null
  }
}

const httpsOnly = (u) => (/^https:\/\/[^\s"'()<>]+$/i.test(String(u || "")) ? u : null)
const clean = (s) => String(s || "").replace(/\^\d|~[a-zA-Z0-9_]+~/g, "").trim()
const cfxCache = new Map() // last good Cfx answer per code, used while Cfx rate-limits

ipcMain.handle("server-status", async (_, address) => {
  const addr = normalise(address)
  const code = (addr.match(/^cfx\.re\/join\/([a-z0-9]+)$/i) || [])[1]
  let direct = IP_PORT.test(addr) ? addr : null

  let c = code ? (await getJson("https://frontend.cfx-services.net/api/servers/single/" + code))?.Data : null
  if (code && c) cfxCache.set(code, c)
  else if (code) c = cfxCache.get(code) || null

  const ep = c?.connectEndPoints?.[0]
  if (!direct && IP_PORT.test(ep || "")) direct = ep

  const [dyn, info, players] = direct
    ? await Promise.all(["dynamic", "info", "players"].map((f) => getJson("http://" + direct + "/" + f + ".json", 2500)))
    : [null, null, null]

  const vars = { ...(c?.vars || {}), ...(info?.vars || {}) } // Cfx adds metadata (icon, banner) the server's own vars lack
  const d = dyn || c
  if (!d) return { online: false, address: addr }
  let list = (players || c?.players || []).map((p) => ({ name: clean(p.name) || "?", id: p.id, ping: p.ping || 0 }))
  if (list.every((p) => p.name === "Player" && !p.ping)) list = [] // Cfx anonymises names on many servers
  return {
    online: true,
    address: addr,
    endpoint: direct,
    name: clean(vars.sv_projectName || d.hostname),
    desc: clean(vars.sv_projectDesc),
    clients: parseInt(d.clients, 10) || list.length,
    maxClients: parseInt(d.sv_maxclients || d.svMaxclients, 10) || 0,
    players: list,
    gameBuild: vars.sv_enforceGameBuild || null,
    discord: vars.discord_link || vars.Discord || vars.discord || null,
    // Art the server owner uploaded to Cfx (only https URLs are passed to the page).
    banner: httpsOnly(vars.banner_detail || vars.banner_connecting),
    icon: httpsOnly(vars.icon_url),
  }
})

// TCP connect round-trip, best of 3.
function tcpConnectOnce(host, port) {
  return new Promise((resolve) => {
    const start = Date.now()
    const sock = new net.Socket()
    let done = false
    const finish = (v) => { if (done) return; done = true; try { sock.destroy() } catch (e) {} resolve(v) }
    sock.setTimeout(2000)
    sock.once("connect", () => finish(Date.now() - start))
    sock.once("timeout", () => finish(null))
    sock.once("error", () => finish(null))
    try { sock.connect(port, host) } catch (e) { finish(null) }
  })
}

ipcMain.handle("ping-server", async (_, endpoint) => {
  if (!IP_PORT.test(String(endpoint || ""))) return null
  const idx = endpoint.lastIndexOf(":")
  const host = endpoint.slice(0, idx)
  const port = parseInt(endpoint.slice(idx + 1), 10) || 30120
  let best = null
  for (let i = 0; i < 3; i++) {
    const ms = await tcpConnectOnce(host, port)
    if (ms != null && (best == null || ms < best)) best = ms
  }
  return best
})

// ── Join ──

ipcMain.handle("join-server", async (_, opts) => {
  const { address, endpoint, name } = opts || {}
  const addr = normalise(address)
  if (!addr) return { success: false, error: "not_configured" }
  // Tell the server's launcher_check resource (if it runs one) that this IP joins via the launcher.
  if (IP_PORT.test(endpoint || "")) {
    // No install id: launcher_check matches the join by IP, so other servers never learn it.
    // mod: what is in RedM's data folders ("none", "unknown" or an approved mod's id), so the server's
    // anticheat knows what to expect. A hint only: the server still measures the game itself.
    const mod = await mods.scan(redmDir, config.mods).catch(() => null)
    fetch("http://" + endpoint + "/launcher_check/hello", {
      method: "POST",
      body: JSON.stringify({ version: app.getVersion(), mod: mod ? mod.id || mod.state : undefined }),
      signal: AbortSignal.timeout(2500),
    }).catch(() => {})
  }
  // Start RedM.exe with the connect link directly: works even when the redm:// link registration
  // is broken (then joining from websites fails, but the launcher still joins).
  const url = "redm://connect/" + addr
  try {
    const exe = await redmExe()
    if (!exe || !(await launch(exe, [url]))) await shell.openExternal(url)
    rpc.setActivity({ details: "Playing on " + (name || addr), startTimestamp: Date.now() })
    return { success: true }
  } catch (e) {
    return { success: false, error: "not_installed" }
  }
})

// ── Anonymous usage heartbeat ──
// Only to the featured server's launcher_check resource, only while enabled in Settings.
// Sends: random install id, launcher version, UI language, whether the game is running. Nothing else.
const usage = { enabled: false, endpoint: null, lang: "" }

async function heartbeat() {
  if (!usage.enabled || !IP_PORT.test(usage.endpoint || "")) return
  const playing = (await redmPids()).length > 0
  fetch("http://" + usage.endpoint + "/launcher_check/heartbeat", {
    method: "POST",
    body: JSON.stringify({ id: launcherId, version: app.getVersion(), lang: usage.lang, playing }),
    signal: AbortSignal.timeout(4000),
  }).catch(() => {})
}
setInterval(heartbeat, 60000)

ipcMain.handle("set-usage", (_, opts) => {
  usage.enabled = !!(opts && opts.enabled)
  usage.endpoint = opts && IP_PORT.test(opts.endpoint || "") ? opts.endpoint : null
  usage.lang = String((opts && opts.lang) || "").slice(0, 8)
  heartbeat()
})

// ── RedM install, client branch, fixes ──

const redmDir = path.join(process.env.LOCALAPPDATA || "", "RedM", "RedM.app")
const iniPath = path.join(redmDir, "CitizenFX.ini")

// Windows' own lookup (Unicode): reg.exe output uses the console code page, which garbles Georgian profile paths.
async function getProtocolExe() {
  try { return (await app.getApplicationInfoForProtocol("redm://")).path || null } catch (e) { return null }
}

// Resolves true once Windows started the exe, false if it couldn't (missing, blocked by antivirus...).
// Without the error listener a failed start is an uncaught exception and a main-process error box.
function launch(exe, args) {
  return new Promise((resolve) => {
    const p = spawn(exe, args, { detached: true, stdio: "ignore" })
    p.once("error", () => resolve(false))
    p.once("spawn", () => { p.unref(); resolve(true) })
  })
}

// RedM.exe: from the redm:// registration when it's intact, else RedM's standard install location.
async function redmExe() {
  const fromProtocol = await getProtocolExe()
  if (fromProtocol && fs.existsSync(fromProtocol)) return fromProtocol
  const standard = path.join(process.env.LOCALAPPDATA || "", "RedM", "RedM.exe")
  return fs.existsSync(standard) ? standard : null
}

// Game processes look like RedM.exe / RedM_b1491_GameProcess.exe (not RedMLauncher etc.).
function redmPids() {
  return new Promise((resolve) => {
    exec("tasklist /fo csv /nh", { windowsHide: true }, (err, out) => {
      if (err) return resolve([])
      resolve(out.split(/\r?\n/).map((l) => l.split('","')).filter((c) => /^"?RedM(_.*)?\.exe$/i.test(c[0] || "")).map((c) => c[1]))
    })
  })
}

async function openGame() {
  const exe = await redmExe()
  if (exe && (await launch(exe, []))) return { success: true }
  try { await shell.openExternal("redm://"); return { success: true } } catch (e) { return { success: false, error: "not_installed" } }
}
ipcMain.handle("open-game", openGame)

function readIni() {
  try { return fs.readFileSync(iniPath, "utf8") } catch (e) { return null }
}

ipcMain.handle("redm-info", async () => {
  const ini = readIni()
  const channel = ini && (ini.match(/^UpdateChannel=(.*)$/m) || [])[1]
  return {
    installed: fs.existsSync(redmDir),
    channel: channel ? channel.trim() : "production",
    running: (await redmPids()).length > 0,
  }
})

// ── Cleanup (see cleanup.js) ──

const cleanEnv = { redmDir, local: process.env.LOCALAPPDATA || "", temp: app.getPath("temp") }

ipcMain.handle("cleanup-meta", () => cleanup.meta())
ipcMain.handle("cleanup-scan-one", (_, id) => cleanup.scanOne(cleanEnv, String(id)))

ipcMain.handle("cleanup-run", async (_, ids) => {
  ids = (Array.isArray(ids) ? ids : []).filter((id) => cleanup.ids().includes(id))
  if (cleanup.needsRedmClosed(cleanEnv, ids) && (await redmPids()).length) return { success: false, error: "running" }
  return { success: true, ...(await cleanup.clean(cleanEnv, ids)) }
})

// ── Graphics and performance (see graphics.js) ──

const gameDir = () => ((readIni() || "").match(/^IVPath=(.*)$/m) || [])[1]?.trim()
const exes = () => graphics.gameExes(path.dirname(redmDir), gameDir())
// RedM keeps its own graphics settings here, not in Documents\Rockstar Games (that one is story mode's).
const systemXml = () => path.join(app.getPath("appData"), "CitizenFX", "rdr3_settings", "system.xml")

ipcMain.handle("graphics-info", async () => ({
  ...(await graphics.state(exes())),
  exes: exes().length,
  hasSettings: fs.existsSync(systemXml()),
}))
ipcMain.handle("undo-gpu", () => graphics.undoGpu(path.dirname(redmDir), gameDir()))
ipcMain.handle("set-fso", (_, on) => graphics.setFso(exes(), !!on))
ipcMain.handle("set-priority-boost", (_, on) => graphics.setPriorityBoost(!!on))

// ── Ready to play: the checks behind the Home checklist ──

ipcMain.handle("readiness", async () => {
  const ini = readIni() || ""
  const channel = ((ini.match(/^UpdateChannel=(.*)$/m) || [])[1] || "production").trim()
  const game = gameDir()
  const [exe, protocol] = await Promise.all([redmExe(), getProtocolExe()])
  let freeBytes = null
  try { const s = await fs.promises.statfs(fs.existsSync(redmDir) ? redmDir : app.getPath("home")); freeBytes = s.bavail * s.bsize } catch (e) {}
  return {
    redm: !!exe,
    links: !!protocol && fs.existsSync(protocol), // redm:// links from Discord and websites open RedM
    game: !!game && fs.existsSync(path.join(game, "RDR2.exe")),
    channel,
    freeBytes,
    mod: await mods.scan(redmDir, config.mods).catch(() => ({ state: "none", files: [] })), // visual mods, see mods.js
  }
})

ipcMain.handle("mods-remove", async () => {
  if ((await redmPids()).length) return { success: false, error: "running" }
  try { return await mods.remove(redmDir) } catch (e) { return { success: false, error: e.code || "failed" } }
})

// Rewrite the redm:// link registration the way RedM itself does (per user, HKCU).
ipcMain.handle("repair-links", async () => {
  const exe = await redmExe()
  if (!exe) return { success: false, error: "not_installed" }
  await graphics.registerProtocol("redm", "RedM", exe)
  return { success: !!(await getProtocolExe()) }
})

// The player's name in RedM (%APPDATA%\CitizenFX\redm.cfg). RedM rewrites that file when it closes,
// so saving waits until RedM isn't running.
const redmCfg = () => path.join(app.getPath("appData"), "CitizenFX", "redm.cfg")
ipcMain.handle("name-get", () => nickname.read(redmCfg()))
ipcMain.handle("name-set", async (_, name) => {
  if (!nickname.valid(name)) return { success: false, error: "invalid" }
  if ((await redmPids()).length) return { success: false, error: "running" }
  try { return nickname.write(redmCfg(), name) } catch (e) { return { success: false, error: e.code || "failed" } }
})

ipcMain.handle("copy-text", (_, text) => clipboard.writeText(String(text || "").slice(0, 20000)))
ipcMain.handle("focus-window", () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

// ── Crash helper: when the game process goes away, check RedM's newest log for a crash ──

function gameRunning() {
  return new Promise((resolve) => exec("tasklist /fo csv /nh", { windowsHide: true }, (err, out) =>
    resolve(!err && /"RedM_b\d+_GTAProcess\.exe"/i.test(out))))
}

let gameWasRunning = false
const reported = new Set()
function checkCrash() {
  const logs = path.join(redmDir, "logs")
  let newest = null
  try {
    for (const n of fs.readdirSync(logs)) {
      const f = path.join(logs, n)
      const t = fs.statSync(f).mtimeMs
      if (/\.log$/i.test(n) && (!newest || t > newest.t)) newest = { f, t }
    }
  } catch (e) { return }
  if (!newest || Date.now() - newest.t > 5 * 60 * 1000) return // only this session's log
  let text
  try { text = fs.readFileSync(newest.f, "utf8") } catch (e) { return } // runs in a timer: a throw here is a main-process error box
  const c = crash.parseCrash(text)
  if (!c) return
  const key = newest.f + ":" + c.at
  if (reported.has(key)) return
  reported.add(key)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("game-crashed", { message: c.message, cause: c.cause, context: c.context, log: path.basename(newest.f) })
    mainWindow.show()
    mainWindow.flashFrame(true)
  }
}
setInterval(async () => {
  const running = await gameRunning()
  if (gameWasRunning && !running) setTimeout(checkCrash, 3000) // give the dump server a moment to write
  gameWasRunning = running
}, 5000)

// Classic fix for crashes after a driver or settings change: the game rebuilds defaults on next start.
ipcMain.handle("reset-graphics", async () => {
  if ((await redmPids()).length) return { success: false, error: "running" }
  const f = systemXml()
  if (!fs.existsSync(f)) return { success: false, error: "no_settings" }
  try { fs.renameSync(f, f + ".backup-" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")) } catch (e) { return { success: false, error: e.code || "failed" } }
  return { success: true }
})

ipcMain.handle("set-channel", async (_, channel) => {
  channel = String(channel || "").trim()
  if (!/^[\w./-]+$/.test(channel)) return { success: false, error: "bad_channel" }
  // latin1 in and out keeps every byte as it was: the file can be ANSI (a Georgian or Cyrillic IVPath
  // would be mangled by a UTF-8 round trip), and only the ASCII UpdateChannel line changes.
  let ini
  try { ini = fs.readFileSync(iniPath, "latin1") } catch (e) { return { success: false, error: "not_installed" } }
  if (/^UpdateChannel=.*$/m.test(ini)) ini = ini.replace(/^UpdateChannel=.*$/m, "UpdateChannel=" + channel)
  else if (/^\[Game\]\s*$/m.test(ini)) ini = ini.replace(/^\[Game\]\s*$/m, "[Game]\r\nUpdateChannel=" + channel)
  else ini = "[Game]\r\nUpdateChannel=" + channel + "\r\n" + ini
  try {
    fs.copyFileSync(iniPath, iniPath + ".bak")
    fs.writeFileSync(iniPath, ini, "latin1")
  } catch (e) { return { success: false, error: e.code || "failed" } }
  return { success: true }
})

ipcMain.handle("kill-redm", async () => {
  const pids = await redmPids()
  await Promise.all(pids.map((pid) => new Promise((r) => exec("taskkill /F /PID " + pid, { windowsHide: true }, r))))
  return { killed: pids.length }
})

ipcMain.handle("restart-redm", async () => {
  const pids = await redmPids()
  await Promise.all(pids.map((pid) => new Promise((r) => exec("taskkill /F /PID " + pid, { windowsHide: true }, r))))
  if (pids.length) await new Promise((r) => setTimeout(r, 2000))
  return openGame()
})

ipcMain.handle("open-folder", (_, which) => {
  const dirs = { logs: "logs", crashes: "crashes", redm: "" }
  if (!(which in dirs)) return
  return shell.openPath(path.join(redmDir, dirs[which]))
})
