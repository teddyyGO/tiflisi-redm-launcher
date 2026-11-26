// Self-check for the visual mod scan, in a temp folder shaped like RedM.app.
// Run: node test/mods.check.js
const assert = require("assert")
const crypto = require("crypto")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { scan, remove } = require("../src/main/mods")

const root = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-mods-"))
const redm = path.join(root, "RedM.app")
const put = (rel, text) => { const f = path.join(redm, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex")

// What RedM ships: listed in its index.
put("content_index.xml", '<ContentFile Name="citizen/common/data/gameconfig.xml" Size="1" />\n<ContentFile Name="citizen/platform/data/startup.ymt" Size="1" />')
put("citizen/common/data/gameconfig.xml", "stock")
put("citizen/platform/data/startup.ymt", "stock")
put("citizen/notes.json", "outside common and platform: not scanned")

const approved = [{ id: "nice-2.0", name: "Nice Visuals 2.0", files: {
  "common/data/visualsettings.dat": sha("vs"),
  "common/data/timecycle/w_sunny.xml": sha("sunny").toUpperCase(), // hash case doesn't matter
} }]

;(async () => {
  assert.strictEqual((await scan(redm, approved)).state, "none", "clean install")
  assert.strictEqual((await scan(path.join(root, "nope"), approved)).state, "none", "no RedM at all: nothing to say")

  put("citizen/common/data/visualsettings.dat", "vs")
  assert.strictEqual((await scan(redm, approved)).state, "unknown", "half of an approved mod is not approved")

  put("citizen/common/data/timecycle/w_sunny.xml", "sunny")
  const ok = await scan(redm, approved)
  assert.deepStrictEqual([ok.state, ok.id, ok.name, ok.files.length], ["approved", "nice-2.0", "Nice Visuals 2.0", 2], "exact approved mod")
  assert.strictEqual((await scan(redm, [])).state, "unknown", "nothing is approved without a list")
  assert.strictEqual((await scan(redm, undefined)).state, "unknown", "missing list")

  put("citizen/common/data/timecycle/w_sunny.xml", "fog removed")
  assert.strictEqual((await scan(redm, approved)).state, "unknown", "approved mod with one file edited")
  put("citizen/common/data/timecycle/w_sunny.xml", "sunny")
  put("citizen/platform/textures/skydome.ytd", "extra")
  const extra = await scan(redm, approved)
  assert.strictEqual(extra.state, "unknown", "approved mod plus one extra file")
  assert.deepStrictEqual(extra.files, ["platform/textures/skydome.ytd"], "only the file the approved mod doesn't have counts")
  const one = await remove(redm, new Date(2026, 0, 2, 3, 4, 5), approved)
  assert.strictEqual(one.moved, 1, "remove takes only the unrecognised file")
  assert.strictEqual(one.folder, path.join(root, "removed-mods", "2026-01-02-03-04-05"), "folder named in local time")
  assert.strictEqual((await scan(redm, approved)).state, "approved", "the approved pack stays")

  const r = await remove(redm, new Date(2026, 0, 2, 3, 4, 6))
  assert.strictEqual(r.moved, 2, "without a list, every added file")
  assert.strictEqual(fs.readFileSync(path.join(r.folder, "common/data/timecycle/w_sunny.xml"), "utf8"), "sunny", "moved, not deleted")
  assert.strictEqual((await scan(redm, approved)).state, "none", "clean again")
  assert.ok(fs.existsSync(path.join(redm, "citizen/common/data/gameconfig.xml")) && fs.existsSync(path.join(redm, "citizen/platform/data/startup.ymt")), "RedM's own files stay")
  assert.ok(!fs.existsSync(path.join(redm, "citizen/common/data/timecycle")) && !fs.existsSync(path.join(redm, "citizen/platform/textures")), "empty mod folders are gone")
  assert.strictEqual((await remove(redm)).moved, 0, "nothing left to remove")

  fs.rmSync(root, { recursive: true, force: true })
  console.log("mods ok")
})().catch((e) => { console.error(e); process.exit(1) })
