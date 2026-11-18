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
function exports() end
function Wait() end
PLAYERS = {}
function GetPlayers() local t = {} for id in pairs(PLAYERS) do t[#t + 1] = tostring(id) end return t end
function GetPlayerName(id) return PLAYERS[tonumber(id)].name end
function GetPlayerPing(id) return 42 end
function GetPlayerEndpoint(id) return PLAYERS[tonumber(id)].endpoint end
function Player() return { state = { set = function() end } } end
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
PLAYERS[1] = { name = 'Giorgi', endpoint = '9.9.9.9:1234' }
PLAYERS[2] = { name = 'Nika', endpoint = '8.8.8.8:1234' }
for _, id in ipairs({ 1, 2 }) do source = id EVENTS.playerJoining() end
request('GET', '/stats.json', nil, { Authorization = 'Basic ${b64("admin:hunter22pass")}' })
check(LAST.playersViaLauncher == 1, 'one player matched to a launcher hello')
for _, p in ipairs(LAST.players) do
  if p.name == 'Giorgi' then check(p.launcher and p.version == '1.0.0', 'Giorgi via launcher') end
  if p.name == 'Nika' then check(not p.launcher, 'Nika without launcher') end
end
check(request('GET', '/nope').code == 404, 'unknown path 404')
print('launcher_check ok')
`

const L = lauxlib.luaL_newstate()
lualib.luaL_openlibs(L)
for (const [name, code] of [["mocks", mocks], ["server.lua", server], ["tests", tests]]) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    console.error(name + ": " + lua.lua_tojsstring(L, -1))
    process.exit(1)
  }
}
