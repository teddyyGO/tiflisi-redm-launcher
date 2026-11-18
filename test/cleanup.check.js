// Self-check for cleanup.js against a fake RedM/AppData/Temp tree (never touches your real folders).
// Run: node test/cleanup.check.js
const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const { scan, clean, needsRedmClosed } = require("../src/main/cleanup")

const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-check-"))
const env = { redmDir: path.join(root, "RedM.app"), local: path.join(root, "Local"), temp: path.join(root, "Temp") }
const put = (rel, bytes, ageDays) => {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Buffer.alloc(bytes))
  if (ageDays) { const t = new Date(Date.now() - ageDays * 86400000); fs.utimesSync(p, t, t) }
  return p
}

put("RedM.app/data/server-cache-priv/a/b.bin", 1000)
put("RedM.app/data/cache/servers/x.bin", 200)
put("RedM.app/data/cache/subprocess/y.exe", 300)
put("RedM.app/data/cache/session", 7)              // kept: sign-in session
put("RedM.app/data/cache/launcher_skip_mtl2", 1)   // kept
put("RedM.app/data/nui-storage/z", 50)
put("RedM.app/crashes/c.dmp", 400)
for (let i = 0; i < 5; i++) put("RedM.app/logs/l" + i + ".log", 10, 5 - i) // l4 newest
put("Local/NVIDIA/DXCache/s.bin", 600)
put("Local/D3DSCache/t.bin", 60)
put("Temp/old.tmp", 70, 5)
put("Temp/fresh.tmp", 80)                          // kept: too new

;(async () => {
  const s = Object.fromEntries((await scan(env)).map((t) => [t.id, t]))
  assert.strictEqual(s.server.bytes, 1200, "server cache = server-cache-priv + cache/servers")
  assert.strictEqual(s.app.bytes, 300, "app cache keeps session + launcher flag")
  assert.strictEqual(s.logs.count, 2, "three newest logs are kept")
  assert.strictEqual(s.shaders.bytes, 660)
  assert.strictEqual(s.temp.bytes, 70, "only temp items older than 2 days")
  assert.strictEqual(s.nui.on, false, "risky targets are off by default")
  assert.strictEqual(needsRedmClosed(env, ["logs", "crashes"]), false)
  assert.strictEqual(needsRedmClosed(env, ["logs", "server"]), true)

  const r = await clean(env, ["server", "app", "logs", "temp"])
  assert.strictEqual(r.failed, 0)
  assert.strictEqual(r.freed, 1200 + 300 + 20 + 70)
  assert(fs.existsSync(path.join(env.redmDir, "data/cache/session")), "session survives")
  assert(fs.existsSync(path.join(env.redmDir, "logs/l4.log")), "newest log survives")
  assert(fs.existsSync(path.join(env.temp, "fresh.tmp")), "fresh temp file survives")
  assert(fs.existsSync(path.join(env.redmDir, "crashes/c.dmp")), "unselected target untouched")
  assert(fs.existsSync(path.join(env.redmDir, "data/server-cache-priv")), "folders themselves are kept, only emptied")
  fs.rmSync(root, { recursive: true, force: true })
  console.log("cleanup ok")
})().catch((e) => { console.error(e); process.exit(1) })
