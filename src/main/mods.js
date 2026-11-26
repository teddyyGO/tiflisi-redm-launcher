// Visual mods in RedM's own data folders.
// RedM overlays citizen\common and citizen\platform on the game's files, so that is where graphics packs
// go: the visual mods a server approves, and the PvP "clear vision" packs its anticheat looks for.
// RedM lists every file it ships in content_index.xml, so anything else in those two folders was added.
// ponytail: only common\ and platform\ are scanned. Packs that also drop files elsewhere in citizen\
// (ui\colors.xml) still show up here through their timecycle files; widen the scan if one doesn't.
const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

async function walk(dir) {
  let entries
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (e) { return [] }
  let out = []
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out = out.concat(await walk(p))
    else out.push(p)
  }
  return out
}

const sha256 = async (file) => crypto.createHash("sha256").update(await fs.promises.readFile(file)).digest("hex")

// Files RedM did not ship, as paths inside citizen\ ("common/data/visualsettings.dat").
async function added(redmDir) {
  let index
  try { index = await fs.promises.readFile(path.join(redmDir, "content_index.xml"), "utf8") } catch (e) { return [] } // no index: can't tell, so say nothing
  const shipped = new Set((index.match(/Name="citizen\/[^"]+"/gi) || []).map((s) => s.slice(14, -1).toLowerCase()))
  const citizen = path.join(redmDir, "citizen")
  const files = (await walk(path.join(citizen, "common"))).concat(await walk(path.join(citizen, "platform")))
  return files.map((f) => path.relative(citizen, f).replace(/\\/g, "/")).filter((f) => !shipped.has(f.toLowerCase())).sort()
}

// approved: config.json "mods": [{ id, name, files: { "common/data/visualsettings.dat": "<sha256>" } }]
// state "none": nothing added. "approved": exactly one approved mod, every file intact. "unknown": anything else,
// which includes an approved mod with one file changed or one file extra.
async function scan(redmDir, approved) {
  const files = await added(redmDir)
  if (!files.length) return { state: "none", files }
  const citizen = path.join(redmDir, "citizen")
  for (const mod of Array.isArray(approved) ? approved : []) {
    const want = new Map(Object.entries((mod && mod.files) || {}).map(([f, h]) => [f.toLowerCase(), String(h).toLowerCase()]))
    if (want.size !== files.length || !files.every((f) => want.has(f.toLowerCase()))) continue
    let intact = true
    for (const f of files) {
      if ((await sha256(path.join(citizen, f))) !== want.get(f.toLowerCase())) { intact = false; break }
    }
    if (intact) return { state: "approved", id: String(mod.id), name: String(mod.name || mod.id), files }
  }
  return { state: "unknown", files: await unrecognised(citizen, files, approved) }
}

// Of the added files, the ones no approved mod has with this exact content. An approved pack with one
// file changed or added then names (and removes) only that file. None left (a pack with files missing):
// every file counts, so the pack isn't half-removed into something new.
async function unrecognised(citizen, files, approved) {
  const known = new Map()
  for (const mod of Array.isArray(approved) ? approved : []) {
    for (const [f, h] of Object.entries((mod && mod.files) || {})) known.set(f.toLowerCase() + "|" + String(h).toLowerCase(), true)
  }
  if (!known.size) return files
  const out = []
  for (const f of files) if (!known.has(f.toLowerCase() + "|" + (await sha256(path.join(citizen, f))))) out.push(f)
  return out.length ? out : files
}

const stamp = (d) => d.getFullYear() + "-" + [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("-")

// Moves the unrecognised files (see scan) to <RedM folder>\removed-mods\<local time>\ (nothing is deleted)
// and tidies the empty folders. Without an approved list, every added file.
async function remove(redmDir, now = new Date(), approved) {
  const citizen = path.join(redmDir, "citizen")
  const scanned = await scan(redmDir, approved)
  const files = scanned.state === "unknown" ? scanned.files : []
  if (!files.length) return { success: true, moved: 0 }
  const folder = path.join(path.dirname(redmDir), "removed-mods", stamp(now))
  for (const f of files) {
    const to = path.join(folder, f)
    await fs.promises.mkdir(path.dirname(to), { recursive: true })
    await fs.promises.rename(path.join(citizen, f), to)
  }
  for (const f of files) {
    for (let d = path.dirname(path.join(citizen, f)); d.length > citizen.length; d = path.dirname(d)) {
      try { await fs.promises.rmdir(d) } catch (e) { break } // not empty: RedM's own files live there
    }
  }
  return { success: true, moved: files.length, folder }
}

module.exports = { scan, remove }
