// Keeps the launcher findable on Windows, checked on every start of the installed app:
//  - a Start Menu shortcut (what Windows Search finds), always;
//  - a Desktop shortcut once (if the player deletes it, it stays deleted);
//  - shortcuts left over from the old name ("RedM Launcher") are cleaned up, and a taskbar pin
//    of the old name is repointed to the current exe so it keeps working.
// Folders and Electron's `shell` come in as arguments so the self-check can use temp folders.
const fs = require("fs")
const path = require("path")

function targetOf(shell, lnk) {
  try { return shell.readShortcutLink(lnk).target || "" } catch (e) { return "" }
}

// Ours = points into our install folder, or at an exe that no longer exists (removed by an update).
function isOurs(shell, lnk, installDir) {
  const t = targetOf(shell, lnk)
  if (!t) return false
  return path.dirname(t).toLowerCase() === installDir.toLowerCase() || !fs.existsSync(t)
}

function ensure(o) {
  const { shell, exe, appId, startMenuDir, desktopDir, pinnedDir, oldNames, stateFile } = o
  const name = o.name || path.basename(exe, ".exe")
  const installDir = path.dirname(exe)
  const link = { target: exe, cwd: installDir, icon: exe, iconIndex: 0, appUserModelId: appId, description: name }
  const done = []
  let state = {}
  try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")) } catch (e) {}

  const write = (lnk) => {
    if (targetOf(shell, lnk).toLowerCase() === exe.toLowerCase()) return false // already right
    fs.mkdirSync(path.dirname(lnk), { recursive: true })
    return shell.writeShortcutLink(lnk, "create", link)
  }

  // Start Menu: always.
  if (write(path.join(startMenuDir, name + ".lnk"))) done.push("start menu")

  // Desktop: once. An old-name desktop shortcut counts as "the player wants one".
  const desk = path.join(desktopDir, name + ".lnk")
  const oldDesk = (oldNames || []).map((n) => path.join(desktopDir, n + ".lnk")).find((l) => fs.existsSync(l) && isOurs(shell, l, installDir))
  if (oldDesk || !state.desktopCreated) {
    if (!fs.existsSync(desk) && write(desk)) done.push("desktop")
    state.desktopCreated = true
  }

  // Old names: remove from Start Menu and Desktop (replaced above); repoint a taskbar pin in place.
  for (const old of oldNames || []) {
    if (old === name) continue
    for (const dir of [startMenuDir, desktopDir]) {
      const l = path.join(dir, old + ".lnk")
      if (fs.existsSync(l) && isOurs(shell, l, installDir)) { fs.rmSync(l, { force: true }); done.push("removed old " + path.basename(dir)) }
    }
    const pin = path.join(pinnedDir, old + ".lnk")
    if (fs.existsSync(pin) && isOurs(shell, pin, installDir) && targetOf(shell, pin).toLowerCase() !== exe.toLowerCase()) {
      if (shell.writeShortcutLink(pin, "update", link)) done.push("taskbar pin repointed")
    }
  }

  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)) } catch (e) {}
  return done
}

module.exports = { ensure }
