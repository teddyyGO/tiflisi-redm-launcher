// The player's name in RedM lives in %APPDATA%\CitizenFX\redm.cfg as:  seta "cl_nickname" "BoldMoth3983"
// Until a player picks one, RedM makes up a name like that (two words + digits).

const fs = require("fs")
const path = require("path")

const LINE = /^seta "cl_nickname" "(.*)"\s*$/m
// RedM's own made-up names: "BoldMoth3983", "MoodyMoth8346".
const MADE_UP = /^[A-Z][a-z]+[A-Z][a-z]+\d{3,4}$/
// Letters (any alphabet, so Georgian works), digits, space, _ . -   No quotes, ^ / ~ colour codes or ; (would break the cfg).
const ALLOWED = /^[\p{L}\p{N} _.\-]{2,32}$/u

function read(cfgPath) {
  let text = ""
  try { text = fs.readFileSync(cfgPath, "utf8") } catch (e) { return { name: "", madeUp: true, exists: false } }
  const m = text.match(LINE)
  const name = m ? m[1] : ""
  return { name, madeUp: !name || MADE_UP.test(name), exists: true }
}

function valid(name) {
  return ALLOWED.test(String(name || "").trim())
}

// Writes the name; returns { success } or { success: false, error: "invalid" }.
function write(cfgPath, name) {
  name = String(name || "").trim().replace(/\s+/g, " ")
  if (!valid(name)) return { success: false, error: "invalid" }
  let text = ""
  try { text = fs.readFileSync(cfgPath, "utf8") } catch (e) {}
  const line = 'seta "cl_nickname" "' + name + '"'
  if (LINE.test(text)) text = text.replace(LINE, line)
  else text = (text && !text.endsWith("\n") ? text + "\r\n" : text) + line + "\r\n"
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
  if (fs.existsSync(cfgPath) && !fs.existsSync(cfgPath + ".launcher-backup")) fs.copyFileSync(cfgPath, cfgPath + ".launcher-backup")
  fs.writeFileSync(cfgPath, text)
  return { success: true, name }
}

module.exports = { read, write, valid }
