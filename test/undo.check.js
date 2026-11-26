// Self-check for the undo list (undo.js) in a temp folder: original branch, graphics backup restore,
// putting moved mod files back without overwriting. Run: node test/undo.check.js
const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const undo = require("../src/main/undo")

;(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "undo-check-"))
  const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) }

  // Branch: the .bak holds the player's own channel; none at all means production.
  const ini = path.join(root, "CitizenFX.ini")
  assert.strictEqual(undo.originalChannel(ini), null, "no .bak: the launcher never changed the branch")
  write(ini + ".bak", "[Game]\r\nIVPath=D:\\RDR2\r\nUpdateChannel=beta\r\n")
  assert.strictEqual(undo.originalChannel(ini), "beta", "reads the original channel, CRLF trimmed")
  write(ini + ".bak", "[Game]\r\nIVPath=D:\\RDR2\r\n")
  assert.strictEqual(undo.originalChannel(ini), "production", "no UpdateChannel line means production")

  // Graphics: the newest backup comes back, RedM's newer file is kept aside (and not listed).
  const xml = path.join(root, "rdr3_settings", "system.xml")
  assert.strictEqual(undo.graphicsBackup(xml), null, "no folder, no backup")
  write(xml + ".backup-2026-11-01-10-00-00", "old")
  write(xml + ".backup-2026-11-20-10-00-00", "newer")
  write(xml + ".backup-oops", "not ours")
  write(xml, "made by RedM")
  assert.strictEqual(undo.graphicsBackup(xml).at, "2026-11-20-10-00-00", "newest of the launcher's backups")
  assert.deepStrictEqual(undo.restoreGraphics(xml, new Date(2026, 10, 26, 9, 5, 7)), { success: true })
  assert.strictEqual(fs.readFileSync(xml, "utf8"), "newer", "backup is system.xml again")
  assert.strictEqual(fs.readFileSync(xml + ".replaced-2026-11-26-09-05-07", "utf8"), "made by RedM", "RedM's file kept")
  assert.strictEqual(undo.graphicsBackup(xml).at, "2026-11-01-10-00-00", "replaced- files are not offered as backups")

  // Mods: moved back into citizen\, never over a file that is there now.
  const redm = path.join(root, "RedM", "RedM.app")
  const backups = path.join(root, "RedM", "removed-mods")
  const stamp = "2026-11-25-18-30-00"
  write(path.join(backups, stamp, "common", "data", "visualsettings.dat"), "mod")
  write(path.join(backups, stamp, "platform", "data", "timecycle", "a.xml"), "mod tc")
  write(path.join(redm, "citizen", "platform", "data", "timecycle", "a.xml"), "player's own now")
  fs.mkdirSync(path.join(backups, "not-a-stamp"), { recursive: true })
  assert.deepStrictEqual(await undo.modBackups(backups), [{ name: stamp, files: 2 }], "lists dated folders with files")
  assert.deepStrictEqual(await undo.restoreMods(redm, backups, "../.."), { success: false, error: "bad_name" }, "no path tricks")
  assert.deepStrictEqual(await undo.restoreMods(redm, backups, stamp), { success: true, moved: 1, kept: 1 })
  assert.strictEqual(fs.readFileSync(path.join(redm, "citizen", "common", "data", "visualsettings.dat"), "utf8"), "mod", "file is back")
  assert.strictEqual(fs.readFileSync(path.join(redm, "citizen", "platform", "data", "timecycle", "a.xml"), "utf8"), "player's own now", "not overwritten")
  assert.deepStrictEqual(await undo.modBackups(backups), [{ name: stamp, files: 1 }], "the kept file stays in its backup")
  assert(!fs.existsSync(path.join(backups, stamp, "common")), "emptied folders are tidied")

  fs.rmSync(root, { recursive: true, force: true })
  console.log("undo ok")
})().catch((e) => { console.error(e); process.exit(1) })
