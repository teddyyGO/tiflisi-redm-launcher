// Graphics and performance tweaks, all per-user and reversible:
//  - Fullscreen optimizations: the same per-app compatibility flag as the exe's Properties > Compatibility tab (HKCU).
//  - High priority: raises the running game process's priority while the launcher is open.
const { execFile, exec } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const GPU_KEY = "HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences"
const LAYERS_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers"
const HIGH_GPU = "GpuPreference=2;"
const FSO_FLAG = "DISABLEDXMAXIMIZEDWINDOWEDMODE"

const reg = (args) => new Promise((r) => execFile("reg", args, { windowsHide: true }, (err, out) => r(err ? null : out)))

async function regGet(key, name) {
  const out = await reg(["query", key, "/v", name])
  if (!out) return null
  const m = out.match(/REG_SZ\s+(.*?)\s*$/m)
  return m ? m[1] : ""
}
const regSet = (key, name, data) => reg(["add", key, "/v", name, "/t", "REG_SZ", "/d", data, "/f"])
const regDel = (key, name) => reg(["delete", key, "/v", name, "/f"])

// Compatibility layers look like "~ HIGHDPIAWARE DISABLEDXMAXIMIZEDWINDOWEDMODE". Add/remove one flag, keep the rest.
function mergeLayers(existing, flag, on) {
  const flags = String(existing || "").replace(/^~\s*/, "").split(/\s+/).filter(Boolean).filter((f) => f !== flag)
  if (on) flags.push(flag)
  return flags.length ? "~ " + flags.join(" ") : null
}

// The game exe (from CitizenFX.ini IVPath), RedM.exe, and each build's RedM_b####_GTAProcess.exe.
function gameExes(redmRoot, gamePath) {
  const out = []
  if (gamePath && fs.existsSync(path.join(gamePath, "RDR2.exe"))) out.push(path.join(gamePath, "RDR2.exe"))
  const launcher = path.join(redmRoot, "RedM.exe")
  if (fs.existsSync(launcher)) out.push(launcher)
  const sub = path.join(redmRoot, "RedM.app", "data", "cache", "subprocess")
  try {
    for (const n of fs.readdirSync(sub)) if (/^RedM_b\d+_GTAProcess\.exe$/i.test(n)) out.push(path.join(sub, n))
  } catch (e) {}
  return out
}

async function state(exes) {
  if (!exes.length) return { fsoOff: false }
  const fso = await Promise.all(exes.map((e) => regGet(LAYERS_KEY, e)))
  return { fsoOff: fso.every((v) => String(v || "").split(/\s+/).includes(FSO_FLAG)) }
}

// Launchers up to 1.1.6 could set "High performance GPU" (Windows Settings > Display > Graphics) for the game.
// Removed: it changes which graphics card counts as number 0, so RedM's saved adapterIndex can point at the
// wrong card, and a PC with the monitor in the motherboard port can stop starting the game. This only
// removes the exact value those launchers wrote.
// Covers exes no longer on disk (Clean up deletes the GTAProcess exe; RedM recreates it at the same path).
// reg.exe output isn't UTF-8 on non-ASCII profile paths, so only the build numbers are read from it and
// each path is rebuilt from redmRoot.
function gpuCandidates(regOut, redmRoot, gamePath) {
  const sub = path.join(redmRoot, "RedM.app", "data", "cache", "subprocess")
  const builds = String(regOut || "").match(/RedM_b\d+_GTAProcess\.exe/gi) || []
  const out = [path.join(redmRoot, "RedM.exe"), ...builds.map((n) => path.join(sub, n))]
  if (gamePath) out.push(path.join(gamePath, "RDR2.exe"))
  return [...new Set(out)]
}

// true when nothing the launcher set is left.
async function undoGpu(redmRoot, gamePath) {
  let ok = true
  for (const e of gpuCandidates(await reg(["query", GPU_KEY]), redmRoot, gamePath)) {
    if ((await regGet(GPU_KEY, e)) === HIGH_GPU && (await regDel(GPU_KEY, e)) === null) ok = false
  }
  return ok
}

// true when every exe got the change (reg.exe answered for each write).
async function setFso(exes, on) {
  let ok = exes.length > 0
  for (const e of exes) {
    const cur = await regGet(LAYERS_KEY, e)
    const next = mergeLayers(cur, FSO_FLAG, on)
    if (next) { if ((await regSet(LAYERS_KEY, e, next)) === null) ok = false }
    else if (cur !== null && (await regDel(LAYERS_KEY, e)) === null) ok = false // nothing there: nothing to delete
  }
  return ok
}

// URL-protocol registration (e.g. redm://), per user: the same keys RedM writes itself.
async function registerProtocol(name, title, exe) {
  const key = "HKCU\\Software\\Classes\\" + name
  await reg(["add", key, "/ve", "/t", "REG_SZ", "/d", title, "/f"])
  await reg(["add", key, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"])
  await reg(["add", key + "\\shell\\open\\command", "/ve", "/t", "REG_SZ", "/d", '"' + exe + '" "%1"', "/f"])
}

// High priority while playing: every 15 s, raise any running RedM game process.
let boostTimer = null
// Turning it off puts a running game back to normal priority.
function setPriorityBoost(on) {
  clearInterval(boostTimer)
  boostTimer = null
  const level = on ? os.constants.priority.PRIORITY_HIGH : os.constants.priority.PRIORITY_NORMAL
  const tick = () => exec("tasklist /fo csv /nh", { windowsHide: true }, (err, out) => {
    if (err) return
    for (const line of out.split(/\r?\n/)) {
      const c = line.split('","')
      if (/^"?RedM_b\d+_GTAProcess\.exe$/i.test(c[0] || "")) {
        try { os.setPriority(parseInt(c[1], 10), level) } catch (e) {}
      }
    }
  })
  tick()
  if (on) boostTimer = setInterval(tick, 15000)
}

async function regDword(key, name) {
  const m = String(await reg(["query", key, "/v", name])).match(/REG_DWORD\s+0x([0-9a-f]+)/i)
  return m ? parseInt(m[1], 16) : null
}

// Windows' own game settings, read only: the launcher shows them and opens the Settings page for each.
async function windowsGaming() {
  const [mode, history, hags] = await Promise.all([
    regDword("HKCU\\Software\\Microsoft\\GameBar", "AutoGameModeEnabled"),
    regDword("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR", "HistoricalCaptureEnabled"),
    regDword("HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers", "HwSchMode"),
  ])
  return {
    gameMode: mode !== 0, // no value: on, the Windows default
    recording: history === 1, // "Record what happened": records the last minutes all the time
    gpuScheduling: hags === null ? null : hags === 2, // no value: left to Windows and the driver
  }
}

// High performance power plan while the game runs, then back to the player's own plan.
// The plan to go back to is kept in a file, so a launcher that closed mid-game still puts it back on its
// next start. Plans are never created: a PC without High performance (many laptops) just can't use this.
const HIGH_PERF = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const powercfg = (args) => new Promise((r) => execFile("powercfg", args, { windowsHide: true }, (err, out) => r(err ? null : out)))
// Only Windows' own everyday plans are switched. A plan the player picked or made (Ultimate Performance, an
// optimizer's plan) is a choice: the launcher leaves it alone.
const EVERYDAY = ["381b4222-f694-41f0-9685-ff5bb260df2e", "a1841308-3d3d-4a4b-ab8b-e3d6fec4f4a5"] // Balanced, Power saver
const hasHighPerf = async () => String(await powercfg(["/list"])).toLowerCase().includes(HIGH_PERF)
const activePlan = async () => ((((await powercfg(["/getactivescheme"])) || "").match(GUID)) || [""])[0].toLowerCase()

function powerPlan(stateFile) {
  let on = false, playing = false, chain = Promise.resolve()
  const saved = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")).plan } catch (e) { return null } }
  async function apply() {
    const prev = saved()
    if (on && playing && !prev) {
      const cur = await activePlan()
      if (!EVERYDAY.includes(cur) || !(await hasHighPerf())) return
      try { fs.writeFileSync(stateFile, JSON.stringify({ plan: cur })) } catch (e) { return }
      await powercfg(["/setactive", HIGH_PERF])
    } else if (!(on && playing) && prev && (await powercfg(["/setactive", prev])) !== null) {
      fs.rmSync(stateFile, { force: true })
    }
  }
  // One change at a time: a click and the game starting can land together.
  const run = () => (chain = chain.then(apply, apply))
  return {
    set: (v) => { on = !!v; return run() },
    game: (v) => { playing = !!v; return run() },
    // "ok"; "none": no High performance plan on this PC; "own": already on High performance or a plan of the player's own.
    status: async () => {
      if (saved()) return "ok" // switched right now, for a game that's running
      if (!(await hasHighPerf())) return "none"
      return EVERYDAY.includes(await activePlan()) ? "ok" : "own"
    },
  }
}

module.exports = { gameExes, state, gpuCandidates, undoGpu, setFso, setPriorityBoost, mergeLayers, registerProtocol, regGet, windowsGaming, powerPlan }
