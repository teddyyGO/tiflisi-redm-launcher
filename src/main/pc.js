// The player's PC, for Tools > Your PC and the crash report: processor, memory, graphics cards with their
// driver dates, Windows build. Plus two things that often get in RedM's way: apps that hook into every
// game, and story-mode mod files left in the RDR2 folder.
const os = require("os")
const fs = require("fs")
const { execFile, exec } = require("child_process")

const YEAR = 365 * 24 * 60 * 60 * 1000

// Win32_VideoController as one line of JSON. PowerShell 5.1 prints one card as an object, several as an array.
const GPU_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = $_.Name; version = $_.DriverVersion; date = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } } } | ConvertTo-Json -Compress"

const vendorOf = (n) => /nvidia|geforce|quadro/i.test(n) ? "nvidia" : /\bamd\b|radeon/i.test(n) ? "amd" : /intel/i.test(n) ? "intel" : "other"

// Virtual displays (remote desktop, streaming, VR) are cards to Windows but never run the game.
function parseGpus(text) {
  let list
  try { list = JSON.parse(text) } catch (e) { return [] }
  return (Array.isArray(list) ? list : [list])
    .filter((g) => g && g.name && !/basic (display|render)|remote display|virtual|parsec|spacedesk|citrix/i.test(g.name))
    .map((g) => ({
      name: String(g.name).trim(),
      version: String(g.version || ""),
      date: /^\d{4}-\d{2}-\d{2}$/.test(g.date || "") ? g.date : null,
      vendor: vendorOf(String(g.name)),
    }))
}

// The cards the game most likely runs on: NVIDIA, AMD and Intel Arc when the PC has one, else every card.
// ponytail: an AMD integrated chip next to an NVIDIA card counts too; fine for a driver-age hint.
function gameGpus(gpus) {
  const dedicated = gpus.filter((g) => g.vendor === "nvidia" || g.vendor === "amd" || /\barc\b/i.test(g.name))
  return dedicated.length ? dedicated : gpus
}

const driverOld = (g, now = Date.now()) => !!g.date && now - Date.parse(g.date) > YEAR

function readGpus() {
  return new Promise((resolve) => execFile("powershell", ["-NoProfile", "-NonInteractive", "-Command", GPU_PS],
    { windowsHide: true, timeout: 20000 }, (err, out) => resolve(err ? [] : parseGpus(out))))
}

// Read once per launcher start (drivers don't change while it runs). A failed read is tried again next time.
let cached = null
function info() {
  if (!cached) {
    cached = readGpus().then((gpus) => {
      if (!gpus.length) cached = null
      const cpu = os.cpus()
      return {
        cpu: ((cpu[0] && cpu[0].model) || "").replace(/\s+/g, " ").trim(),
        threads: cpu.length,
        ramBytes: os.totalmem(),
        windowsBuild: parseInt(os.release().split(".")[2], 10) || null,
        gpus: gpus.map((g) => ({ ...g, game: gameGpus(gpus).includes(g), old: gameGpus(gpus).includes(g) && driverOld(g) })),
      }
    })
  }
  return cached
}

// Overlay and audio-effect apps that hook into every game. RedM crash reports often name their DLLs
// (rtsshooks64.dll, NahimicOSD.dll). Shown as a hint, never closed by the launcher.
const HOOKS = [
  ["rtss.exe", "RivaTuner Statistics Server"],
  ["nahimicsvc64.exe", "Nahimic"],
  ["nahimicsvc32.exe", "Nahimic"],
]

function hooksIn(tasklistCsv) {
  const running = new Set(String(tasklistCsv || "").split(/\r?\n/).map((l) => l.split('","')[0].replace(/^"/, "").toLowerCase()))
  return [...new Set(HOOKS.filter(([exe]) => running.has(exe)).map(([, name]) => name))]
}

const runningHooks = () => new Promise((resolve) =>
  exec("tasklist /fo csv /nh", { windowsHide: true }, (err, out) => resolve(err ? [] : hooksIn(out))))

// Story-mode mod loaders and graphics injectors in the RDR2 folder. The usual first thing staff ask a
// crashing player to move out. RDR2 ships none of these names.
const STORY_MODS = ["scripthookrdr2.dll", "dinput8.dll", "version.dll", "dxgi.dll", "d3d11.dll", "d3d12.dll", "reshade.ini", "lml"]

function storyMods(gameDir) {
  if (!gameDir) return []
  let names
  try { names = fs.readdirSync(gameDir) } catch (e) { return [] }
  return names.filter((n) => STORY_MODS.includes(n.toLowerCase()) || /\.asi$/i.test(n)).sort()
}

module.exports = { info, parseGpus, gameGpus, driverOld, hooksIn, runningHooks, storyMods }
