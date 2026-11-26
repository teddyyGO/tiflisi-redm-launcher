// What the launcher changed on disk, and the way back. The switches (fullscreen optimizations, priority,
// power plan) undo through their own toggles; this covers the changes that left a backup behind.
// Paths come in as arguments so the self-check can use temp folders.
const fs = require("fs")
const path = require("path")
const { stamp, walk } = require("./mods")

// Folder and backup names the launcher writes: local time to the second, "-2" when two land in one second.
const STAMP = /^\d{4}(-\d{2}){5}(-\d+)?$/

// The branch in the player's own CitizenFX.ini, from the .bak that set-channel keeps once. null: no .bak,
// so the launcher never changed the branch.
function originalChannel(iniPath) {
  let bak
  try { bak = fs.readFileSync(iniPath + ".bak", "latin1") } catch (e) { return null }
  return ((bak.match(/^UpdateChannel=(.*)$/m) || [])[1] || "production").trim()
}

// Newest "Reset graphics settings" backup next to system.xml: { file, at } or null.
function graphicsBackup(xml) {
  let names = []
  try { names = fs.readdirSync(path.dirname(xml)) } catch (e) { return null }
  const base = path.basename(xml) + ".backup-"
  const b = names.filter((n) => n.startsWith(base) && STAMP.test(n.slice(base.length))).sort().pop()
  return b ? { file: path.join(path.dirname(xml), b), at: b.slice(base.length) } : null
}

// Puts the newest backup back. The settings RedM made since are kept, under a name the list doesn't show.
function restoreGraphics(xml, now = new Date()) {
  const b = graphicsBackup(xml)
  if (!b) return { success: false, error: "no_backup" }
  if (fs.existsSync(xml)) fs.renameSync(xml, xml + ".replaced-" + stamp(now))
  fs.renameSync(b.file, xml)
  return { success: true }
}

// Folders the visual mods check moved files into (removed-mods\<time>), newest first, with their file counts.
async function modBackups(root) {
  let names = []
  try { names = await fs.promises.readdir(root) } catch (e) { return [] }
  const out = []
  for (const name of names.filter((n) => STAMP.test(n)).sort().reverse()) {
    const files = (await walk(path.join(root, name))).length
    if (files) out.push({ name, files })
  }
  return out
}

// Removes empty folders, bottom up. rmdir refuses a folder with anything left in it.
async function prune(dir) {
  let entries = []
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch (e) { return }
  for (const e of entries) if (e.isDirectory()) await prune(path.join(dir, e.name))
  try { await fs.promises.rmdir(dir) } catch (e) {}
}

// Moves a backup's files back into citizen\. Never over a file that is there now: those stay in the backup.
async function restoreMods(redmDir, root, name) {
  if (!STAMP.test(String(name))) return { success: false, error: "bad_name" }
  const from = path.join(root, name)
  const citizen = path.join(redmDir, "citizen")
  let moved = 0, kept = 0
  for (const f of await walk(from)) {
    const to = path.join(citizen, path.relative(from, f))
    if (fs.existsSync(to)) { kept++; continue }
    await fs.promises.mkdir(path.dirname(to), { recursive: true })
    await fs.promises.rename(f, to)
    moved++
  }
  await prune(from)
  return { success: true, moved, kept }
}

module.exports = { originalChannel, graphicsBackup, restoreGraphics, modBackups, restoreMods }
