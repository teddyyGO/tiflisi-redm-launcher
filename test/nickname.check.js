// Self-check for nickname.js on a temp copy of a real-looking redm.cfg. Run: node test/nickname.check.js
const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const nick = require("../src/main/nickname")

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nickname-check-"))
const cfg = path.join(dir, "redm.cfg")
fs.writeFileSync(cfg, 'seta "cl_nickname" "BoldMoth3983"\r\nseta "con_autoScroll" "true"\r\nseta "ui_muteOnFocusLoss" "false"\r\n')

let r = nick.read(cfg)
assert.strictEqual(r.name, "BoldMoth3983")
assert.strictEqual(r.madeUp, true, "RedM's random name is recognised")

assert.deepStrictEqual(nick.write(cfg, "  Giorgi   Tbilisi "), { success: true, name: "Giorgi Tbilisi" })
r = nick.read(cfg)
assert.strictEqual(r.name, "Giorgi Tbilisi")
assert.strictEqual(r.madeUp, false)
const text = fs.readFileSync(cfg, "utf8")
assert(text.includes('seta "con_autoScroll" "true"') && text.includes('seta "ui_muteOnFocusLoss" "false"'), "other settings kept")
assert.strictEqual(text.match(/cl_nickname/g).length, 1, "replaced, not duplicated")
assert(fs.existsSync(cfg + ".launcher-backup"), "original kept as a backup")

assert.strictEqual(nick.write(cfg, "გიორგი").success, true, "Georgian names work")
for (const bad of ['a', 'x"; quit', "^1Red", "~r~Name", "a".repeat(33), "name;cmd"]) {
  assert.strictEqual(nick.write(cfg, bad).success, false, "refused: " + bad)
}
assert.strictEqual(nick.read(cfg).name, "გიორგი", "a refused name changes nothing")

const fresh = path.join(dir, "sub", "redm.cfg")
assert.strictEqual(nick.read(fresh).exists, false)
assert.strictEqual(nick.write(fresh, "Nika").success, true, "creates redm.cfg if RedM never ran")
assert.strictEqual(nick.read(fresh).name, "Nika")

fs.rmSync(dir, { recursive: true, force: true })
console.log("nickname ok")
