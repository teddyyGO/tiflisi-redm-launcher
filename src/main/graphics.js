// Graphics and performance tweaks, all per-user and reversible:
//  - GPU preference: the same per-app setting as Windows Settings > Display > Graphics (HKCU).
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
  if (!exes.length) return { gpuHigh: false, fsoOff: false }
  const gpu = await Promise.all(exes.map((e) => regGet(GPU_KEY, e)))
  const fso = await Promise.all(exes.map((e) => regGet(LAYERS_KEY, e)))
  return {
    gpuHigh: gpu.every((v) => v === HIGH_GPU),
    fsoOff: fso.every((v) => String(v || "").split(/\s+/).includes(FSO_FLAG)),
  }
}

async function setGpu(exes, on) {
  for (const e of exes) {
    if (on) await regSet(GPU_KEY, e, HIGH_GPU)
    else if ((await regGet(GPU_KEY, e)) === HIGH_GPU) await regDel(GPU_KEY, e) // only undo what we set
  }
}

async function setFso(exes, on) {
  for (const e of exes) {
    const next = mergeLayers(await regGet(LAYERS_KEY, e), FSO_FLAG, on)
    if (next) await regSet(LAYERS_KEY, e, next)
    else await regDel(LAYERS_KEY, e)
  }
}

function gpuNames() {
  return new Promise((r) => exec('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name"', { windowsHide: true }, (err, out) =>
    r(err ? [] : out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))))
}

// High priority while playing: every 15 s, raise any running RedM game process.
let boostTimer = null
function setPriorityBoost(on) {
  clearInterval(boostTimer)
  boostTimer = null
  if (!on) return
  const tick = () => exec("tasklist /fo csv /nh", { windowsHide: true }, (err, out) => {
    if (err) return
    for (const line of out.split(/\r?\n/)) {
      const c = line.split('","')
      if (/^"?RedM_b\d+_GTAProcess\.exe$/i.test(c[0] || "")) {
        try { os.setPriority(parseInt(c[1], 10), os.constants.priority.PRIORITY_HIGH) } catch (e) {}
      }
    }
  })
  tick()
  boostTimer = setInterval(tick, 15000)
}

module.exports = { gameExes, state, setGpu, setFso, gpuNames, setPriorityBoost, mergeLayers }
