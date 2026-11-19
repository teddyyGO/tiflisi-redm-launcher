// Self-check for the compatibility-flag merge (pure logic; does not touch the registry).
// Run: node test/graphics.check.js
const assert = require("assert")
const { mergeLayers, gpuCandidates } = require("../src/main/graphics")
const path = require("path")
const F = "DISABLEDXMAXIMIZEDWINDOWEDMODE"

assert.strictEqual(mergeLayers(null, F, true), "~ " + F, "adds to an empty value")
assert.strictEqual(mergeLayers("~ HIGHDPIAWARE", F, true), "~ HIGHDPIAWARE " + F, "keeps other flags")
assert.strictEqual(mergeLayers("~ HIGHDPIAWARE " + F, F, true), "~ HIGHDPIAWARE " + F, "no duplicates")
assert.strictEqual(mergeLayers("~ HIGHDPIAWARE " + F, F, false), "~ HIGHDPIAWARE", "removes only ours")
assert.strictEqual(mergeLayers("~ " + F, F, false), null, "empty result means delete the value")
// undoGpu targets: build numbers come from reg.exe output (mangled on non-ASCII paths), full paths from redmRoot.
const root = String.raw`C:\Users\გიორგი\AppData\Local\RedM`
const regOut = String.raw`
HKEY_CURRENT_USER\Software\Microsoft\DirectX\UserGpuPreferences
    C:\Users\??????\AppData\Local\RedM\RedM.app\data\cache\subprocess\RedM_b1491_GTAProcess.exe    REG_SZ    GpuPreference=2;
`
const c = gpuCandidates(regOut, root, String.raw`D:\Games\RDR2`)
assert(c.includes(path.join(root, "RedM.app", "data", "cache", "subprocess", "RedM_b1491_GTAProcess.exe")), "deleted GTAProcess exe rebuilt with the real profile path")
assert(c.includes(path.join(root, "RedM.exe")) && c.includes(String.raw`D:\Games\RDR2\RDR2.exe`), "RedM.exe and RDR2.exe always checked")
assert.strictEqual(gpuCandidates(null, root, "").length, 1, "no reg output and no game path: only RedM.exe")
console.log("graphics ok")
