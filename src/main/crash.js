// Reads RedM's own log after the game closes. When RedM crashes, its DumpServer writes
//   [   482078] [    DumpServer]   11048/ Process crash captured. Crash dialog content:
//   [   482078] [    DumpServer]   11048/ Assertion failure: productId != ProductID::INVALID
// We pull out that message and sort it into a plain-language cause the launcher can explain.

const MARKER = "Process crash captured"
const DUMP_LINE = /^\[\s*\d+\]\s*\[\s*DumpServer\]\s*\d+\/\s?(.*)$/

// Most specific first. Keys map to translated explanations in the renderer (crash.cause.<key>).
const CAUSES = [
  ["memory", /out of memory|ERR_MEM|EMBEDDEDALLOC|not enough memory|allocation failed/i],
  ["graphics", /ERR_GFX|D3D|DXGI|DEVICE_REMOVED|DEVICE_HUNG|VK_ERROR|vulkan|nvwgf|atidxx|igdumd|graphics driver/i],
  ["pool", /pool (is )?full|PoolSize|pool.?overflow|\bpools?\b.*exceeded/i],
  ["files", /ERR_FIL|corrupt|\.rpf|damaged|checksum|failed to (read|open) .*game/i],
  ["start", /productId|CfxState|ROS|SocialClub|Rockstar|entitlement|sign.?in|launcher/i],
]

function classify(message) {
  for (const [key, re] of CAUSES) if (re.test(message)) return key
  return "unknown"
}

// Returns null when this log shows no crash, else { message, cause, context, at }.
function parseCrash(text) {
  const at = text.lastIndexOf(MARKER)
  if (at === -1) return null
  const after = text.slice(at).split(/\r?\n/).slice(1, 12)
  const message = []
  for (const line of after) {
    const m = line.match(DUMP_LINE)
    if (!m) break
    if (m[1].trim()) message.push(m[1].trim())
  }
  const msg = message.join("\n") || "(no details in the log)"
  return { message: msg, cause: classify(msg), context: text.slice(0, at).split(/\r?\n/).slice(-30).join("\n"), at }
}

module.exports = { parseCrash, classify }
