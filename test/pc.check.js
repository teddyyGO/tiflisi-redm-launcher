// Self-check for the PC panel and Ready hints (pc.js): graphics card parsing, which cards count for the
// driver-age warning, hook apps in tasklist output, story-mode mods in a game folder. Run: node test/pc.check.js
const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const pc = require("../src/main/pc")

// PowerShell prints one card as an object, several as an array.
const one = pc.parseGpus('{"name":"NVIDIA GeForce RTX 3060","version":"32.0.15.6094","date":"2024-08-14"}')
assert.deepStrictEqual(one, [{ name: "NVIDIA GeForce RTX 3060", version: "32.0.15.6094", date: "2024-08-14", vendor: "nvidia" }])
const many = pc.parseGpus(JSON.stringify([
  { name: "Intel(R) UHD Graphics 770", version: "31.0.101.4502", date: "2023-06-01" },
  { name: "AMD Radeon RX 7800 XT", version: "32.0.12011.1036", date: null },
  { name: "Microsoft Basic Display Adapter", version: "10.0", date: "2006-06-21" },
  { name: "Parsec Virtual Display Adapter", version: "0.45", date: "2023-01-01" },
]))
assert.deepStrictEqual(many.map((g) => g.vendor), ["intel", "amd"], "virtual and basic adapters dropped")
assert.deepStrictEqual(pc.parseGpus("not json"), [], "bad output: no cards")

// Driver age counts for the card the game runs on: the dedicated one when there is one.
assert.deepStrictEqual(pc.gameGpus(many).map((g) => g.vendor), ["amd"], "integrated Intel ignored next to a Radeon")
assert.strictEqual(pc.gameGpus([many[0]]).length, 1, "only integrated: that one counts")
const now = Date.parse("2026-11-26")
assert.strictEqual(pc.driverOld({ date: "2025-10-01" }, now), true, "over a year: old")
assert.strictEqual(pc.driverOld({ date: "2026-03-01" }, now), false, "months old: fine")
assert.strictEqual(pc.driverOld({ date: null }, now), false, "no date: no warning")

// tasklist /fo csv /nh
const tasks = '"System Idle Process","0","Services","0","8 K"\r\n"RTSS.exe","4412","Console","1","12,000 K"\r\n"NahimicSvc64.exe","3100","Services","0","9,000 K"\r\n"NahimicSvc32.exe","3104","Services","0","5,000 K"\r\n'
assert.deepStrictEqual(pc.hooksIn(tasks), ["RivaTuner Statistics Server", "Nahimic"], "found once each, by name")
assert.deepStrictEqual(pc.hooksIn('"explorer.exe","1","Console","1","1 K"'), [], "nothing hooking")

const game = fs.mkdtempSync(path.join(os.tmpdir(), "pc-check-"))
for (const f of ["RDR2.exe", "bink2w64.dll", "ScriptHookRDR2.dll", "dinput8.dll", "NativeTrainer.asi", "ReShade.ini"]) fs.writeFileSync(path.join(game, f), "")
fs.mkdirSync(path.join(game, "lml"))
assert.deepStrictEqual(pc.storyMods(game), ["NativeTrainer.asi", "ReShade.ini", "ScriptHookRDR2.dll", "dinput8.dll", "lml"], "mod files only, not the game's own")
assert.deepStrictEqual(pc.storyMods(path.join(game, "missing")), [], "no folder: nothing")
assert.deepStrictEqual(pc.storyMods(""), [], "no game path: nothing")
fs.rmSync(game, { recursive: true, force: true })
console.log("pc ok")
