// Cache cleanup. Each target lists the files/folders it would delete; sizes are measured live.
// Paths come in through `env` so the self-check can point everything at a fake folder.
const fs = require("fs")
const fsp = fs.promises
const path = require("path")

const DAY = 24 * 60 * 60 * 1000

async function list(dir, keep) {
  try {
    return (await fsp.readdir(dir)).filter((n) => !(keep || []).includes(n)).map((n) => path.join(dir, n))
  } catch (e) {
    return []
  }
}

// Newest mtime anywhere under p: a folder's own mtime only changes when its direct children do,
// so an old folder can still hold files written today. Unreadable counts as "now" (keep it).
async function newest(p) {
  let st
  try { st = await fsp.lstat(p) } catch (e) { return Date.now() }
  if (!st.isDirectory()) return st.mtimeMs
  let names = []
  try { names = await fsp.readdir(p) } catch (e) { return Date.now() }
  const times = await Promise.all(names.map((n) => newest(path.join(p, n))))
  return times.reduce((a, b) => Math.max(a, b), st.mtimeMs)
}

async function olderThan(paths, ms) {
  const out = []
  for (const p of paths) if (Date.now() - (await newest(p)) > ms) out.push(p)
  return out
}

// With TMP/TEMP unset Windows falls back to the user profile: never empty a folder not named Temp/Tmp.
const isTempDir = (p) => /^te?mp$/i.test(path.basename(p || ""))

// env: { redmDir, local (LOCALAPPDATA), temp }
function targets(env) {
  const data = path.join(env.redmDir, "data")
  const gpu = ["NVIDIA/DXCache", "NVIDIA/GLCache", "AMD/DxCache", "AMD/DxcCache", "AMD/GLCache", "AMD/VkCache", "Intel/ShaderCache", "D3DSCache"]
  return [
    // redm: true = RedM must be closed (it holds these files open). on = ticked by default.
    // Server cache starts unticked: clearing it re-downloads every server's files on the next join.
    { id: "server", redm: true, on: false, entries: async () => [
      ...(await list(path.join(data, "server-cache"))),
      ...(await list(path.join(data, "server-cache-priv"))),
      ...(await list(path.join(data, "cache", "servers"))),
    ] },
    // Everything else in data/cache; keeps the sign-in session and launcher flags.
    { id: "app", redm: true, on: true, entries: () => list(path.join(data, "cache"), ["servers", "session", "launcher_skip_mtl2"]) },
    { id: "crashes", redm: false, on: true, entries: () => list(path.join(env.redmDir, "crashes")) },
    // All logs except the three newest (staff usually want the latest one).
    { id: "logs", redm: false, on: true, entries: async () => {
      const files = await list(path.join(env.redmDir, "logs"))
      const withTime = []
      for (const f of files) { try { withTime.push([f, (await fsp.lstat(f)).mtimeMs]) } catch (e) {} }
      return withTime.sort((a, b) => b[1] - a[1]).slice(3).map((x) => x[0])
    } },
    // In-game UI storage: resets UI settings and web logins inside servers.
    { id: "nui", redm: true, on: true, entries: () => list(path.join(data, "nui-storage")) },
    // GPU driver shader caches: rebuilt on next launch (first minutes may stutter).
    { id: "shaders", redm: true, on: true, entries: async () => (await Promise.all(gpu.map((g) => list(path.join(env.local, g))))).flat() },
    // Untouched for 2 days (like Windows Disk Cleanup), judged by the newest file inside, so running installers keep their files.
    { id: "temp", redm: false, on: true, entries: async () => isTempDir(env.temp) ? olderThan(await list(env.temp), 2 * DAY) : [] },
  ]
}

async function sizeOf(p) {
  let st
  try { st = await fsp.lstat(p) } catch (e) { return 0 }
  if (!st.isDirectory()) return st.size
  let names = []
  try { names = await fsp.readdir(p) } catch (e) { return 0 }
  // Children measured in parallel (lstat never follows links out of the folder).
  const sizes = await Promise.all(names.map((name) => sizeOf(path.join(p, name))))
  return sizes.reduce((a, b) => a + b, 0)
}

// Ids + defaults, instantly (no disk walk), so the UI can draw rows before sizes arrive.
const meta = () => targets({ redmDir: "", local: "", temp: "" }).map((t) => ({ id: t.id, on: t.on, redm: t.redm }))

async function scanOne(env, id) {
  const t = targets(env).find((x) => x.id === id)
  if (!t) return null
  const entries = await t.entries()
  const sizes = await Promise.all(entries.map(sizeOf))
  return { id, bytes: sizes.reduce((a, b) => a + b, 0), count: entries.length }
}

async function scan(env) {
  const sized = await Promise.all(meta().map((m) => scanOne(env, m.id)))
  return meta().map((m, i) => ({ ...m, ...sized[i] }))
}

// Deletes the selected targets. Files in use are skipped and counted, never fatal.
async function clean(env, ids) {
  let freed = 0, failed = 0
  for (const t of targets(env).filter((x) => ids.includes(x.id))) {
    for (const e of await t.entries()) {
      const bytes = await sizeOf(e)
      try {
        await fsp.rm(e, { recursive: true, force: true, maxRetries: 1 })
        freed += bytes
      } catch (err) {
        failed++
        freed += Math.max(0, bytes - (await sizeOf(e))) // whatever part did get removed
      }
    }
  }
  return { freed, failed }
}

const needsRedmClosed = (env, ids) => targets(env).some((t) => t.redm && ids.includes(t.id))

module.exports = { scan, scanOne, meta, clean, needsRedmClosed, ids: () => meta().map((m) => m.id) }
