-- launcher_check: knows who plays through the launcher, and shows it live.
--
-- 1. Launcher joins: right before opening redm://connect the launcher POSTs /launcher_check/hello.
--    We remember the caller's IP for a few minutes and match it when the player connects.
-- 2. Live usage: while open, the launcher POSTs /launcher_check/heartbeat every 60 s with a random
--    install id, its version, UI language and whether the game is running. No names, no files.
--    (Players can switch this off in the launcher's Settings.)
-- 3. Dashboard: http://<server-ip>:<port>/launcher_check/dashboard  (user "admin", your password)
--
-- Convars:
--   set launcher_check_mode "log"                  -- "log" (default): just tag players; "require": refuse non-launcher joins
--   set launcher_check_url  "https://..."          -- download link shown to refused players
--   set launcher_check_ttl  300                    -- seconds a hello stays valid
--   set launcher_check_dashboard_password "..."    -- turns the dashboard on (8+ characters; off when unset)
--
-- Limitation: joins are matched by IP, so players behind one NAT share a hello. Upgrade to a signed
-- token passed through the connect flow if that starts to matter.
-- Note: FXServer serves this over plain HTTP. Use a password you don't use anywhere else.

local hellos = {}      -- ip -> { at, version }
local viaLauncher = {} -- server id -> hello
local launchers = {}   -- install id -> { ip, version, lang, playing, seen }
local uniqueSinceStart = 0
local LIVE = 150       -- seconds without a heartbeat before a launcher counts as closed
local MAX_LAUNCHERS = 5000

SetConvarServerInfo('launcher_check', '1')

local function ipOf(endpoint)
  return endpoint and endpoint:match('^%[?([^%]]+)%]?:%d+$') or endpoint
end

local function str(v, pattern, max)
  v = type(v) == 'string' and v or ''
  if #v > max or not v:match(pattern) then return nil end
  return v
end

local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64(s)
  return ((s:gsub('.', function(c)
    local b, r = c:byte(), ''
    for i = 8, 1, -1 do r = r .. (b % 2 ^ i - b % 2 ^ (i - 1) > 0 and '1' or '0') end
    return r
  end) .. '0000'):gsub('%d%d?%d?%d?%d?%d?', function(x)
    if #x < 6 then return '' end
    local c = 0
    for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2 ^ (6 - i) or 0) end
    return B64:sub(c + 1, c + 1)
  end) .. ({ '', '==', '=' })[#s % 3 + 1])
end

local function authorized(req)
  local pw = GetConvar('launcher_check_dashboard_password', '')
  if #pw < 8 then return nil end -- dashboard off
  local h = req.headers and (req.headers['Authorization'] or req.headers['authorization']) or ''
  return h == 'Basic ' .. base64('admin:' .. pw)
end

local function snapshot()
  local now = os.time()
  local open, playing, versions, langs = 0, 0, {}, {}
  for id, l in pairs(launchers) do
    if now - l.seen > LIVE then
      launchers[id] = nil
    else
      open = open + 1
      if l.playing then playing = playing + 1 end
      versions[l.version] = (versions[l.version] or 0) + 1
      langs[l.lang] = (langs[l.lang] or 0) + 1
    end
  end
  local players, via = {}, 0
  for _, sid in ipairs(GetPlayers()) do
    local h = viaLauncher[tonumber(sid)]
    if h then via = via + 1 end
    players[#players + 1] = { id = tonumber(sid), name = GetPlayerName(sid), ping = GetPlayerPing(sid), launcher = h ~= nil, version = h and h.version or '' }
  end
  return {
    time = now, launchersOpen = open, launchersInGame = playing, uniqueSinceStart = uniqueSinceStart,
    versions = versions, languages = langs, players = players, playersViaLauncher = via,
    launcherPlayersEver = GetResourceKvpInt('stat:ever'),
    mode = GetConvar('launcher_check_mode', 'log'),
  }
end

local DASHBOARD = [==[<!doctype html><html><head><meta charset="utf-8"><title>Launcher usage</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;background:#15110f;color:#f3eee6;font:14px/1.5 system-ui,sans-serif;padding:28px}
h1{font-size:26px;margin:0 0 4px}.sub{color:#a69d93;margin-bottom:22px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:22px}
.card{background:#221a16;border:1px solid #3a2f29;border-radius:12px;padding:14px 16px}
.num{font-size:32px;font-weight:800}.lbl{color:#a69d93;font-size:13px}
table{width:100%;border-collapse:collapse;background:#221a16;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 14px;border-bottom:1px solid #3a2f29}th{color:#a69d93;font-weight:600}
.yes{color:#7bd88f}.no{color:#ff8a7a}.chips span{display:inline-block;background:#2e241f;border-radius:99px;padding:2px 10px;margin:0 6px 6px 0}
</style></head><body>
<h1>Launcher usage</h1><div class="sub" id="sub">Loading...</div>
<div class="cards">
<div class="card"><div class="num" id="open">-</div><div class="lbl">Launchers open now</div></div>
<div class="card"><div class="num" id="ingame">-</div><div class="lbl">Of those, in game</div></div>
<div class="card"><div class="num" id="via">-</div><div class="lbl">Players who joined via launcher</div></div>
<div class="card"><div class="num" id="without">-</div><div class="lbl">Players who joined without</div></div>
<div class="card"><div class="num" id="unique">-</div><div class="lbl">Different launchers since server start</div></div>
<div class="card"><div class="num" id="ever">-</div><div class="lbl">Players who ever joined via launcher</div></div>
</div>
<p class="lbl">Launcher versions</p><div class="chips" id="versions"></div>
<p class="lbl">Languages</p><div class="chips" id="langs"></div>
<p class="lbl">Players</p>
<table><thead><tr><th>ID</th><th>Name</th><th>Ping</th><th>Joined via launcher</th></tr></thead><tbody id="players"></tbody></table>
<script>
function chips(el, o){el.textContent='';Object.keys(o).sort(function(a,b){return o[b]-o[a]}).forEach(function(k){var s=document.createElement('span');s.textContent=(k||'?')+': '+o[k];el.appendChild(s)})}
function load(){fetch('stats.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
document.getElementById('open').textContent=d.launchersOpen;document.getElementById('ingame').textContent=d.launchersInGame;
document.getElementById('via').textContent=d.playersViaLauncher;document.getElementById('without').textContent=d.players.length-d.playersViaLauncher;
document.getElementById('unique').textContent=d.uniqueSinceStart;document.getElementById('ever').textContent=d.launcherPlayersEver;
document.getElementById('sub').textContent='Live, refreshes every 5 seconds. Join check mode: '+d.mode+'. Updated '+new Date().toLocaleTimeString();
chips(document.getElementById('versions'),d.versions||{});chips(document.getElementById('langs'),d.languages||{});
var tb=document.getElementById('players');tb.textContent='';(d.players||[]).sort(function(a,b){return a.id-b.id}).forEach(function(p){
var tr=document.createElement('tr');[p.id,p.name,p.ping+' ms'].forEach(function(v){var td=document.createElement('td');td.textContent=v;tr.appendChild(td)});
var td=document.createElement('td');td.className=p.launcher?'yes':'no';td.textContent=p.launcher?('Yes'+(p.version?' ('+p.version+')':'')):'No';tr.appendChild(td);tb.appendChild(tr)})
}).catch(function(){document.getElementById('sub').textContent='Could not load stats. Retrying...'})}
load();setInterval(load,5000);
</script></body></html>]==]

local function readBody(req, cb)
  req.setDataHandler(function(body)
    local ok, data = pcall(json.decode, body or '')
    cb(ok and type(data) == 'table' and data or {})
  end)
end

SetHttpHandler(function(req, res)
  local path = (req.path or ''):gsub('%?.*$', '')

  if req.method == 'POST' and path == '/hello' then
    readBody(req, function(data)
      local ip = ipOf(req.address)
      local ttl = GetConvarInt('launcher_check_ttl', 300)
      for k, v in pairs(hellos) do if os.time() - v.at > ttl then hellos[k] = nil end end
      if ip then hellos[ip] = { at = os.time(), version = str(data.version, '^[%w%.%-]+$', 20) or '' } end
      res.writeHead(204); res.send('')
    end)
    return
  end

  if req.method == 'POST' and path == '/heartbeat' then
    readBody(req, function(data)
      local id = str(data.id, '^[%w%-]+$', 64)
      if id then
        local count = 0
        if not launchers[id] then -- new launcher: count it, unless the table is full (spam guard)
          for _ in pairs(launchers) do count = count + 1 end
          if count < MAX_LAUNCHERS then uniqueSinceStart = uniqueSinceStart + 1 end
        end
        if launchers[id] or count < MAX_LAUNCHERS then
          launchers[id] = {
            ip = ipOf(req.address),
            version = str(data.version, '^[%w%.%-]+$', 20) or '?',
            lang = str(data.lang, '^[%a_]+$', 8) or '?',
            playing = data.playing == true,
            seen = os.time(),
          }
        end
      end
      res.writeHead(204); res.send('')
    end)
    return
  end

  if req.method == 'GET' and (path == '/dashboard' or path == '/stats.json') then
    local ok = authorized(req)
    if ok == nil then res.writeHead(404); res.send('Dashboard is off. Set launcher_check_dashboard_password (8+ characters).'); return end
    if not ok then
      res.writeHead(401, { ['WWW-Authenticate'] = 'Basic realm="launcher_check", charset="UTF-8"', ['Content-Type'] = 'text/plain' })
      res.send('Login required.')
      return
    end
    if path == '/stats.json' then
      res.writeHead(200, { ['Content-Type'] = 'application/json', ['Cache-Control'] = 'no-store' })
      res.send(json.encode(snapshot()))
    else
      res.writeHead(200, { ['Content-Type'] = 'text/html; charset=utf-8', ['Cache-Control'] = 'no-store' })
      res.send(DASHBOARD)
    end
    return
  end

  res.writeHead(404); res.send('')
end)

local function lookup(src)
  local h = hellos[ipOf(GetPlayerEndpoint(src))]
  if h and os.time() - h.at <= GetConvarInt('launcher_check_ttl', 300) then return h end
end

AddEventHandler('playerConnecting', function(name, _, deferrals)
  local src = source
  if lookup(src) then return end
  if GetConvar('launcher_check_mode', 'log') == 'require' then
    local url = GetConvar('launcher_check_url', '')
    deferrals.defer()
    Wait(0)
    deferrals.done('Please join through the server launcher.' .. (url ~= '' and ('\nDownload: ' .. url) or ''))
  else
    print(('[launcher_check] %s joined without the launcher'):format(name))
  end
end)

local function licenseOf(src)
  for _, id in ipairs(GetPlayerIdentifiers(src) or {}) do
    if id:sub(1, 8) == 'license:' then return id end
  end
end

-- The connecting id changes once the player is fully joined, so tag on join.
AddEventHandler('playerJoining', function()
  local src = source
  viaLauncher[src] = lookup(src)
  Player(src).state:set('viaLauncher', viaLauncher[src] ~= nil, true)
  if not viaLauncher[src] then return end
  -- Count each Rockstar license once, ever (KVP survives restarts).
  local lic = licenseOf(src)
  if lic and GetResourceKvpInt('seen:' .. lic) ~= 1 then
    SetResourceKvpInt('seen:' .. lic, 1)
    SetResourceKvpInt('stat:ever', GetResourceKvpInt('stat:ever') + 1)
  end
  -- Other resources can react: AddEventHandler('launcher_check:joined', function(src, version) ... end)
  TriggerEvent('launcher_check:joined', src, viaLauncher[src].version)
end)

AddEventHandler('playerDropped', function() viaLauncher[source] = nil end)

-- exports.launcher_check:UsedLauncher(src) -> bool, launcherVersion
exports('UsedLauncher', function(src)
  local h = viaLauncher[tonumber(src)]
  return h ~= nil, h and h.version or nil
end)

-- exports.launcher_check:ClaimOnce(src, key) -> true only the first time this Rockstar license claims `key`
-- while playing through the launcher. Use it for one-time rewards; every later call returns false.
exports('ClaimOnce', function(src, key)
  src = tonumber(src)
  if not viaLauncher[src] then return false end
  local lic = licenseOf(src)
  if not lic then return false end
  local k = 'claim:' .. tostring(key or 'reward') .. ':' .. lic
  if GetResourceKvpInt(k) == 1 then return false end
  SetResourceKvpInt(k, 1)
  return true
end)

-- Console: launcherstats
RegisterCommand('launcherstats', function(src)
  if src ~= 0 then return end
  local s = snapshot()
  print(('[launcher_check] launchers open: %d (%d in game) | players via launcher: %d of %d | different launchers since start: %d')
    :format(s.launchersOpen, s.launchersInGame, s.playersViaLauncher, #s.players, s.uniqueSinceStart))
end, true)
