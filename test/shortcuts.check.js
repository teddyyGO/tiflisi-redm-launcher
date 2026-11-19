// Self-check for shortcuts.js with Electron's real shortcut API, in temp folders (never your real ones).
// Run: npx electron test/shortcuts.check.js
const { app, shell } = require("electron")
const assert = require("assert")
const fs = require("fs")
const os = require("os")
const path = require("path")
const shortcuts = require("../src/main/shortcuts")

app.whenReady().then(() => {
  let code = 0
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shortcuts-check-"))
  try {
    const dir = (n) => { const d = path.join(root, n); fs.mkdirSync(d, { recursive: true }); return d }
    const install = dir("Programs/open-redm-launcher")
    const other = dir("Programs/tiflisi-1898")
    const exe = path.join(install, "Tiflisi Launcher.exe")
    fs.writeFileSync(exe, "")
    fs.writeFileSync(path.join(other, "Tiflisi 1898.exe"), "")
    const sm = dir("StartMenu"), desk = dir("Desktop"), pin = dir("TaskBar")
    const oldExe = path.join(install, "RedM Launcher.exe") // removed by the update, so it doesn't exist
    for (const d of [sm, desk, pin]) shell.writeShortcutLink(path.join(d, "RedM Launcher.lnk"), "create", { target: oldExe })
    shell.writeShortcutLink(path.join(pin, "Tiflisi 1898.lnk"), "create", { target: path.join(other, "Tiflisi 1898.exe") })
    const opts = { shell, exe, appId: "io.github.openredmlauncher", startMenuDir: sm, desktopDir: desk, pinnedDir: pin, oldNames: ["RedM Launcher"], stateFile: path.join(root, "state.json") }
    // Compare real paths: the temp folder can come back in short 8.3 form (C:\Users\RUNNER~1\...).
    const target = (l) => fs.realpathSync.native(shell.readShortcutLink(l).target)
    const realExe = fs.realpathSync.native(exe)

    const first = shortcuts.ensure(opts)
    assert.strictEqual(target(path.join(sm, "Tiflisi Launcher.lnk")), realExe, "Start Menu shortcut created")
    assert.strictEqual(shell.readShortcutLink(path.join(sm, "Tiflisi Launcher.lnk")).appUserModelId, "io.github.openredmlauncher", "carries the app id")
    assert.strictEqual(target(path.join(desk, "Tiflisi Launcher.lnk")), realExe, "Desktop shortcut created (an old one existed)")
    assert(!fs.existsSync(path.join(sm, "RedM Launcher.lnk")), "old Start Menu shortcut removed")
    assert(!fs.existsSync(path.join(desk, "RedM Launcher.lnk")), "old Desktop shortcut removed")
    assert.strictEqual(target(path.join(pin, "RedM Launcher.lnk")), realExe, "taskbar pin repointed in place (stays pinned)")
    assert.strictEqual(target(path.join(pin, "Tiflisi 1898.lnk")), fs.realpathSync.native(path.join(other, "Tiflisi 1898.exe")), "other app's pin untouched")
    console.log("first start:", first.join(", "))

    assert.deepStrictEqual(shortcuts.ensure(opts), [], "second start changes nothing")
    // Same exe in its short 8.3 spelling (what Windows sometimes hands out) still counts as already right.
    const short = require("child_process").execSync('cmd /c for %A in ("' + exe + '") do @echo %~sA').toString().trim()
    const again = shortcuts.ensure({ ...opts, exe: short }); assert.deepStrictEqual(again, [], "short and long spellings of one path are the same (" + short + "), but it did: " + again.join(", "))
    fs.rmSync(path.join(desk, "Tiflisi Launcher.lnk"))
    shortcuts.ensure(opts)
    assert(!fs.existsSync(path.join(desk, "Tiflisi Launcher.lnk")), "a deleted Desktop shortcut stays deleted")
    fs.rmSync(path.join(sm, "Tiflisi Launcher.lnk"))
    shortcuts.ensure(opts)
    assert(fs.existsSync(path.join(sm, "Tiflisi Launcher.lnk")), "Start Menu shortcut always comes back (Windows Search needs it)")
    console.log("shortcuts ok")
  } catch (e) {
    console.error(e)
    code = 1
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    app.exit(code)
  }
})
