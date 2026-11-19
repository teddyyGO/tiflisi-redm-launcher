// Self-check for crash.js. The first case is a real RedM crash from a CitizenFX log.
// Run: node test/crash.check.js
const assert = require("assert")
const { parseCrash, classify } = require("../src/main/crash")

const real = [
  "[    482000] [b1491_GTAProce]             MainThrd/ Starting tf_poolhud",
  "[    482078] [    DumpServer]                11048/ Process crash captured. Crash dialog content:",
  "[    482078] [    DumpServer]                11048/ Assertion failure: productId != ProductID::INVALID",
  "[    482078] [    DumpServer]                11048/ File: ..\\..\\..\\code\\client\\shared\\CfxState.h, Line: 88",
  "[    482100] [b1491_GTAProce]             MainThrd/ something after",
].join("\r\n")

const c = parseCrash(real)
assert(c, "crash found")
assert.strictEqual(c.message.split("\n")[0], "Assertion failure: productId != ProductID::INVALID")
assert.strictEqual(c.message.split("\n").length, 2, "stops at the first non-DumpServer line")
assert.strictEqual(c.cause, "start")
assert(c.context.includes("Starting tf_poolhud"), "keeps the lines before the crash for staff")

assert.strictEqual(parseCrash("[  1] [b1491_GTAProce] MainThrd/ all fine"), null, "no crash, no report")
assert.strictEqual(classify("ERR_MEM_EMBEDDEDALLOC_ALLOC"), "memory")
assert.strictEqual(classify("DXGI_ERROR_DEVICE_REMOVED"), "graphics")
assert.strictEqual(classify("Pool full: CObject"), "pool")
assert.strictEqual(classify("ERR_FIL_PACK_1 corrupt update_4.rpf"), "files")
assert.strictEqual(classify("Something nobody has seen"), "unknown")
console.log("crash ok")
