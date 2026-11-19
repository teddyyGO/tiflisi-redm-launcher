// privacy.txt -> privacy.rtf for the installer's privacy page. The page's text box draws Georgian with a
// fallback font whose spacing doesn't fit (letters overlap), so the RTF names Segoe UI, which covers
// both Georgian and Latin. Edit privacy.txt, then run: node installer/make-rtf.js
const fs = require("fs")
const path = require("path")
const txt = fs.readFileSync(path.join(__dirname, "privacy.txt"), "utf8").replace(/^\uFEFF/, "").trimEnd()
const esc = (s) => s.replace(/[\\{}]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, (c) => "\\u" + c.charCodeAt(0) + "?")
const lines = txt.split(/\r?\n/).map((l, i) => (i === 0 ? "{\\b " + esc(l) + "}" : esc(l)))
const rtf = "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Segoe UI;}}\\uc1\\pard\\f0\\fs18\r\n" + lines.join("\\par\r\n") + "\\par\r\n}\r\n"
fs.writeFileSync(path.join(__dirname, "privacy.rtf"), rtf)
console.log("privacy.rtf:", rtf.length, "bytes")
