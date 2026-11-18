// Cfx public server list: one protobuf stream of every FiveM + RedM server.
// Framing: [uint32 LE length][Server message] repeated. Schema (Cfx servers.proto):
//   Server     { 1: EndPoint (join code), 2: Data }
//   ServerData { 1: svMaxclients, 2: clients, 4: hostname, 5: gametype, 6: mapname,
//                11: iconVersion, 12: vars (map<string,string>), 17: upvotePower, 18: connectEndPoints }
// Hand-rolled decoder (no protobuf dependency): we only need varints and length-delimited fields.

const STREAM_URL = "https://frontend.cfx-services.net/api/servers/streamRedir/"

function varint(b, p) {
  let x = 0, s = 0, c
  do { c = b[p.i++]; x += (c & 0x7f) * 2 ** s; s += 7 } while (c & 0x80 && p.i < b.length)
  return x
}

// Calls cb(field, number) for varints and cb(field, null, start, end) for length-delimited values.
function eachField(b, start, end, cb) {
  const p = { i: start }
  while (p.i < end) {
    const tag = varint(b, p)
    const f = Math.floor(tag / 8), w = tag & 7
    if (w === 0) cb(f, varint(b, p))
    else if (w === 2) { const len = varint(b, p); cb(f, null, p.i, p.i + len); p.i += len }
    else if (w === 5) p.i += 4
    else if (w === 1) p.i += 8
    else return // unknown wire type: stop reading this message
  }
}

const str = (b, s, e) => b.toString("utf8", s, e)
const clean = (s) => String(s || "").replace(/\^\d|~[a-zA-Z0-9_]+~/g, "").replace(/\s+/g, " ").trim()

function decodeServer(b, start, end) {
  const out = { code: "", max: 0, clients: 0, hostname: "", vars: {}, upvote: 0 }
  eachField(b, start, end, (f, n, s, e) => {
    if (f === 1 && n === null) out.code = str(b, s, e)
    if (f === 2 && n === null) {
      eachField(b, s, e, (g, m, s2, e2) => {
        if (g === 1) out.max = m
        else if (g === 2) out.clients = m
        else if (g === 4) out.hostname = str(b, s2, e2)
        else if (g === 17) out.upvote = m
        else if (g === 12) {
          let k = "", v = ""
          eachField(b, s2, e2, (h, _n, s3, e3) => { if (h === 1) k = str(b, s3, e3); else if (h === 2) v = str(b, s3, e3) })
          if (k) out.vars[k] = v
        }
      })
    }
  })
  return out
}

const httpsOnly = (u) => (/^https:\/\/[^\s"'()<>]+$/i.test(String(u || "")) ? u : null)

// Returns every RedM server (gamename rdr3), trimmed to what the browser shows.
function parseStream(buf) {
  const list = []
  let i = 0
  while (i + 4 <= buf.length) {
    const len = buf.readUInt32LE(i)
    const s = i + 4, e = s + len
    if (e > buf.length) break
    i = e
    const sv = decodeServer(buf, s, e)
    if (sv.vars.gamename !== "rdr3" || !sv.code) continue
    const v = sv.vars
    list.push({
      address: "cfx.re/join/" + sv.code,
      name: clean(v.sv_projectName || sv.hostname) || sv.code,
      desc: clean(v.sv_projectDesc).slice(0, 160),
      clients: sv.clients,
      maxClients: sv.max,
      locale: (v.locale || "").split("-")[0].toLowerCase() || "",
      tags: String(v.tags || "").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 8),
      icon: httpsOnly(v.icon_url),
      banner: httpsOnly(v.banner_detail || v.banner_connecting),
      upvote: sv.upvote,
    })
  }
  return list
}

let cache = { at: 0, list: null }

// Cached for 2 minutes: the stream is ~21 MB.
async function getRedmServers(force) {
  if (!force && cache.list && Date.now() - cache.at < 120000) return cache.list
  const res = await fetch(STREAM_URL, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error("Server list returned HTTP " + res.status)
  const list = parseStream(Buffer.from(await res.arrayBuffer()))
  cache = { at: Date.now(), list }
  return list
}

module.exports = { getRedmServers, parseStream }
