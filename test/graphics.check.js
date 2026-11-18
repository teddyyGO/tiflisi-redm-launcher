// Self-check for the compatibility-flag merge (pure logic; does not touch the registry).
// Run: node test/graphics.check.js
const assert = require("assert")
const { mergeLayers } = require("../src/main/graphics")
const F = "DISABLEDXMAXIMIZEDWINDOWEDMODE"

assert.strictEqual(mergeLayers(null, F, true), "~ " + F, "adds to an empty value")
assert.strictEqual(mergeLayers("~ HIGHDPIAWARE", F, true), "~ HIGHDPIAWARE " + F, "keeps other flags")
assert.strictEqual(mergeLayers("~ HIGHDPIAWARE " + F, F, true), "~ HIGHDPIAWARE " + F, "no duplicates")
assert.strictEqual(mergeLayers("~ HIGHDPIAWARE " + F, F, false), "~ HIGHDPIAWARE", "removes only ours")
assert.strictEqual(mergeLayers("~ " + F, F, false), null, "empty result means delete the value")
console.log("graphics ok")
