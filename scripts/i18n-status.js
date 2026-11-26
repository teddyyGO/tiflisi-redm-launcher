// How complete each translation is, and what is missing.
//   node scripts/i18n-status.js       one line per language (Markdown table, as in the README)
//   node scripts/i18n-status.js de    the English strings German still lacks, ready to translate and paste
//                                     into an Object.assign(i18nTranslations.de, { ... }) block in app.js
// Settings only lists a language once it has 90% of the English strings; the rest falls back to English.
const fs = require("fs")
const path = require("path")
const vm = require("vm")

const src = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8")
const ctx = {}
// Only the translation data: everything before the first function, which needs a page to run.
vm.runInNewContext(src.slice(0, src.indexOf("function detectLanguage")), ctx)
const { i18nTranslations: T, i18nLanguageList: L } = ctx
const en = Object.keys(T.en)
const missing = (code) => en.filter((k) => !(T[code] || {})[k])

const code = process.argv[2]
if (code) {
  if (!T[code]) { console.error("No language " + code + ". Codes: " + L.map((l) => l.code).join(" ")); process.exit(1) }
  const m = missing(code)
  console.log(m.length ? m.map((k) => "  " + JSON.stringify(k) + ": " + JSON.stringify(T.en[k])).join(",\n") : code + " is complete.")
} else {
  console.log("| Language | Done | In Settings |\n|---|---|---|")
  for (const l of L) {
    const done = Math.floor((100 * (en.length - missing(l.code).length)) / en.length)
    console.log("| " + l.name + " (`" + l.code + "`) | " + done + "% | " + (done >= 90 ? "yes" : "no") + " |")
  }
}
