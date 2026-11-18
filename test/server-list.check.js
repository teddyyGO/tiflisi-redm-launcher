// Self-check for the Cfx stream decoder: builds two framed protobuf messages by hand and decodes them.
// Run: node test/server-list.check.js   (add --live to also hit the real Cfx feed)
const assert = require("assert")
const { parseStream, getRedmServers } = require("../src/main/server-list")

const varint = (n) => { const o = []; while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128) } o.push(n); return Buffer.from(o) }
const fld = (f, payload) => Buffer.concat([varint(f * 8 + 2), varint(payload.length), payload])
const num = (f, n) => Buffer.concat([varint(f * 8), varint(n)])
const s = (x) => Buffer.from(x, "utf8")
const kv = (k, v) => fld(12, Buffer.concat([fld(1, s(k)), fld(2, s(v))]))
const frame = (msg) => { const h = Buffer.alloc(4); h.writeUInt32LE(msg.length); return Buffer.concat([h, msg]) }

const redm = Buffer.concat([fld(1, s("abc123")), fld(2, Buffer.concat([
  num(1, 200), num(2, 74), fld(4, s("^1Wild ^7West RP")), kv("gamename", "rdr3"), kv("locale", "ka-GE"),
  kv("tags", "Roleplay, georgian"), kv("icon_url", "https://img.example/i.png"), kv("banner_detail", "javascript:alert(1)"),
]))])
const fivem = Buffer.concat([fld(1, s("zzz999")), fld(2, Buffer.concat([num(2, 900), fld(4, s("GTA city")), kv("gamename", "gta5")]))])

const list = parseStream(Buffer.concat([frame(redm), frame(fivem)]))
assert.strictEqual(list.length, 1, "only rdr3 servers are kept")
const r = list[0]
assert.strictEqual(r.address, "cfx.re/join/abc123")
assert.strictEqual(r.name, "Wild West RP", "colour codes stripped")
assert.strictEqual(r.clients, 74)
assert.strictEqual(r.maxClients, 200)
assert.strictEqual(r.locale, "ka")
assert.deepStrictEqual(r.tags, ["roleplay", "georgian"])
assert.strictEqual(r.icon, "https://img.example/i.png")
assert.strictEqual(r.banner, null, "non-https art is dropped")
assert.deepStrictEqual(parseStream(Buffer.from([1, 2, 3])), [], "truncated input is ignored")
console.log("decoder ok")

if (process.argv.includes("--live")) {
  getRedmServers().then((all) => {
    assert(all.length > 50, "expected a real RedM list, got " + all.length)
    const top = all.slice().sort((a, b) => b.clients - a.clients).slice(0, 5)
    console.log("live RedM servers:", all.length, "players online:", all.reduce((n, x) => n + x.clients, 0))
    top.forEach((x) => console.log(" ", x.clients + "/" + x.maxClients, x.locale || "-", x.name.slice(0, 50)))
  })
}
