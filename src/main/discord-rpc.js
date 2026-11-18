// Minimal Discord Rich Presence over the local IPC pipe (no dependency).
// Silently does nothing when Discord isn't running.
const net = require("net")

let sock = null
let clientId = null
let pending = null

function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

function connect(i) {
  if (i > 9) return
  const s = net.createConnection("\\\\?\\pipe\\discord-ipc-" + i)
  s.once("connect", () => {
    sock = s
    s.write(frame(0, { v: 1, client_id: clientId }))
    if (pending) send(pending)
  })
  s.once("error", () => connect(i + 1))
  s.on("data", () => {}) // drain replies
  s.once("close", () => { if (sock === s) sock = null })
}

function send(activity) {
  sock.write(frame(1, { cmd: "SET_ACTIVITY", args: { pid: process.pid, activity }, nonce: String(Date.now()) }))
}

exports.start = (id) => { clientId = id; connect(0) }

exports.setActivity = (activity) => {
  if (!clientId) return
  pending = activity
  if (sock) send(activity)
  else connect(0)
}
