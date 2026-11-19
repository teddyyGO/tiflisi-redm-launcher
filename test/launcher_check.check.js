// Runs server-resource/launcher_check/server.lua in a Lua VM (fengari) with FXServer natives mocked,
// then exercises hello, heartbeat, the password-protected dashboard and join matching.
// Run: node test/launcher_check.check.js   (needs `npm i --no-save fengari` once)
const fs = require("fs")
const path = require("path")
let fengari
try { fengari = require("fengari") } catch (e) { console.log("skip: fengari not installed (npm i --no-save fengari)"); process.exit(0) }
const { lua, lauxlib, lualib, to_luastring } = fengari

const server = fs.readFileSync(path.join(__dirname, "../server-resource/launcher_check/server.lua"), "utf8")
const b64 = (s) => Buffer.from(s, "utf8").toString("base64")

const mocks = `
CONVARS = {}
function GetConvar(k, d) return CONVARS[k] or d end
function GetConvarInt(k, d) return tonumber(CONVARS[k]) or d end
function SetConvarServerInfo() end
local handler
function SetHttpHandler(f) handler = f end
EVENTS = {}
function AddEventHandler(n, f) EVENTS[n] = f end
function RegisterCommand() end
function Wait() end
PLAYERS = {}
function GetPlayers() local t = {} for id in pairs(PLAYERS) do t[#t + 1] = tostring(id) end return t end
function GetPlayerName(id) return PLAYERS[tonumber(id)].name end
function GetPlayerPing(id) return 42 end
function GetPlayerEndpoint(id) return PLAYERS[tonumber(id)].endpoint end
function Player() return { state = { set = function() end } } end
function GetPlayerIdentifiers(id) return PLAYERS[tonumber(id)].ids or {} end
KVP = {}
function GetResourceKvpInt(k) return KVP[k] or 0 end
function SetResourceKvpInt(k, v) KVP[k] = v end
FIRED = {}
function TriggerEvent(name, ...) FIRED[#FIRED + 1] = { name = name, args = { ... } } end
-- exports('Name', fn) registers; exports.resource:Name(...) calls another resource (colon call passes self).
EXPORTS = {}
RESOURCES = {}
exports = setmetatable({}, {
  __call = function(_, name, fn) EXPORTS[name] = fn end,
  __index = function(_, res) return RESOURCES[res] end,
})
json = {}
function json.decode(s)
  if not s:match('^%s*{') then error('bad json') end
  local t = {}
  for k, v in s:gmatch('"([^"]+)"%s*:%s*("?[^,}"]*"?)') do
    if v:sub(1, 1) == '"' then t[k] = v:sub(2, -2) elseif v == 'true' then t[k] = true elseif v == 'false' then t[k] = false else t[k] = tonumber(v) end
  end
  return t
end
function json.encode(t) LAST = t return 'json' end
function request(method, p, body, headers, address)
  local out = {}
  handler({ method = method, path = p, headers = headers or {}, address = address or '1.2.3.4:5555',
    setDataHandler = function(cb) cb(body) end },
    { writeHead = function(code, h) out.code = code out.headers = h or {} end, send = function(b) out.body = b end })
  return out
end
function check(cond, msg) if not cond then error('FAIL: ' .. msg, 2) end end
`

const tests = `
-- heartbeats
check(request('POST', '/heartbeat', '{"id":"abc-123","version":"1.0.0","lang":"ka","playing":true}').code == 204, 'heartbeat accepted')
request('POST', '/heartbeat', '{"id":"abc-123","version":"1.0.0","lang":"ka","playing":true}') -- same launcher again
request('POST', '/heartbeat', '{"id":"zzz-9","version":"1.1.0","lang":"en","playing":false}')
request('POST', '/heartbeat', '{"id":"../etc/passwd","version":"1","lang":"en"}') -- invalid id: ignored
request('POST', '/heartbeat', 'not json')                                          -- garbage: ignored, no crash

-- dashboard is off without a password, then locked, then open with the right one
check(request('GET', '/stats.json').code == 404, 'dashboard off without password')
CONVARS.launcher_check_dashboard_password = 'hunter22pass'
local r = request('GET', '/stats.json')
check(r.code == 401 and r.headers['WWW-Authenticate'], 'login required')
check(request('GET', '/stats.json', nil, { Authorization = 'Basic ${b64("admin:wrongpassword")}' }).code == 401, 'wrong password refused')
r = request('GET', '/stats.json?t=1', nil, { Authorization = 'Basic ${b64("admin:hunter22pass")}' })
check(r.code == 200, 'right password accepted (query string ignored)')
check(LAST.launchersOpen == 2, 'two launchers open, got ' .. tostring(LAST.launchersOpen))
check(LAST.launchersInGame == 1, 'one in game')
check(LAST.uniqueSinceStart == 2, 'repeat heartbeats are not new launchers')
check(LAST.versions['1.0.0'] == 1 and LAST.languages.ka == 1, 'versions and languages counted')
r = request('GET', '/dashboard', nil, { authorization = 'Basic ${b64("admin:hunter22pass")}' })
check(r.code == 200 and r.body:find('Launcher usage', 1, true), 'dashboard page served (lowercase header too)')

-- join matching: hello from an IP, then that IP connects
request('POST', '/hello', '{"id":"abc-123","version":"1.0.0"}', nil, '9.9.9.9:4000')
PLAYERS[1] = { name = 'Giorgi', endpoint = '9.9.9.9:1234', ids = { 'steam:1', 'license:aaa' } }
PLAYERS[2] = { name = 'Nika', endpoint = '8.8.8.8:1234', ids = { 'license:bbb' } }
for _, id in ipairs({ 1, 2 }) do source = id EVENTS.playerJoining() end
request('GET', '/stats.json', nil, { Authorization = 'Basic ${b64("admin:hunter22pass")}' })
check(LAST.playersViaLauncher == 1, 'one player matched to a launcher hello')
for _, p in ipairs(LAST.players) do
  if p.name == 'Giorgi' then check(p.launcher and p.version == '1.0.0', 'Giorgi via launcher') end
  if p.name == 'Nika' then check(not p.launcher, 'Nika without launcher') end
end
check(request('GET', '/nope').code == 404, 'unknown path 404')

-- rewards and lifetime tracking
check(#FIRED == 1 and FIRED[1].name == 'launcher_check:joined' and FIRED[1].args[1] == 1, 'joined event fired for the launcher player only')
check(EXPORTS.ClaimOnce(1, 'welcome') == true, 'first claim succeeds')
check(EXPORTS.ClaimOnce(1, 'welcome') == false, 'second claim refused')
check(EXPORTS.ClaimOnce(2, 'welcome') == false, 'non-launcher player cannot claim')
check(EXPORTS.ClaimOnce(1, 'other') == true, 'different reward keys are separate')
check(LAST.launcherPlayersEver == 1, 'one license ever via launcher')
source = 1 EVENTS.playerJoining() -- same player rejoins
request('GET', '/stats.json', nil, { Authorization = 'Basic ${b64("admin:hunter22pass")}' })
check(LAST.launcherPlayersEver == 1, 'rejoining does not count twice')
check(EXPORTS.ClaimOnce(1, 'welcome') == false, 'claim stays used after rejoining')
print('launcher_check ok')

-- set up the world for launcher_reward_vorp
RESOURCES.launcher_check = {
  UsedLauncher = function(_, s) return EXPORTS.UsedLauncher(s) end,
  ClaimOnce = function(_, s, k) return EXPORTS.ClaimOnce(s, k) end,
}
MONEY, NOTES, CHARS = {}, {}, { [1] = true, [2] = true }
RESOURCES.vorp_core = { GetCore = function() return {
  getUser = function(s) return { getUsedCharacter = CHARS[s] and { addCurrency = function(cur, n) MONEY[s] = (MONEY[s] or 0) + (cur == 0 and n or 0) end } or nil } end,
  NotifyRightTip = function(s, text) NOTES[#NOTES + 1] = text end,
} end }
`

const rewardTests = `
local paid = function(s) return MONEY[s] or 0 end
CHARS[1] = nil
EVENTS['vorp:SelectedCharacter'](1)
check(paid(1) == 0 and EXPORTS.ClaimOnce ~= nil, 'no character loaded: nothing paid')
CHARS[1] = true
EVENTS['vorp:SelectedCharacter'](1)
check(paid(1) == 10, 'launcher player paid the default $10 (claim was not burned while no character was loaded)')
check(NOTES[1]:find('+$10', 1, true), 'player told about the bonus')
EVENTS['vorp:SelectedCharacter'](1)
check(paid(1) == 10, 'paid only once')
EVENTS['vorp:SelectedCharacter'](2)
check(paid(2) == 0, 'player without the launcher gets nothing')
CONVARS.launcher_reward_money = '0'
PLAYERS[3] = { name = 'Ana', endpoint = '9.9.9.9:2', ids = { 'license:ccc' } }
request('POST', '/hello', '{"id":"q","version":"1.0.3"}', nil, '9.9.9.9:4001')
source = 3 EVENTS.playerJoining() CHARS[3] = true
EVENTS['vorp:SelectedCharacter'](3)
check(paid(3) == 0, 'amount 0 turns the reward off')
print('launcher_reward_vorp ok')
`
const reward = fs.readFileSync(path.join(__dirname, "../server-resource/launcher_reward_vorp/server.lua"), "utf8")

const L = lauxlib.luaL_newstate()
lualib.luaL_openlibs(L)
for (const [name, code] of [["mocks", mocks], ["server.lua", server], ["tests", tests], ["reward server.lua", reward], ["reward tests", rewardTests]]) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    console.error(name + ": " + lua.lua_tojsstring(L, -1))
    process.exit(1)
  }
}
