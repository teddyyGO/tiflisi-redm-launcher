-- launcher_reward_vorp: a one-time money bonus for players who join through the launcher.
-- Paid once per Rockstar license (not per character), when a character is loaded.
-- Needs launcher_check (ensure it first) and vorp_core.
--
-- Convars:
--   set launcher_reward_money 10                                   -- amount in dollars; 0 turns the reward off
--   set launcher_reward_message "Thanks for playing with the launcher! +$%s"
--
-- Keep it modest: the launcher's join signal can be imitated by someone who reads the open-source code.

local Core = exports.vorp_core:GetCore()

AddEventHandler('vorp:SelectedCharacter', function(src)
  local amount = GetConvarInt('launcher_reward_money', 10)
  if amount <= 0 then return end
  if not exports.launcher_check:UsedLauncher(src) then return end
  local user = Core.getUser(src)
  local character = user and user.getUsedCharacter
  if not character then return end -- no character yet: don't use up the claim
  if not exports.launcher_check:ClaimOnce(src, 'welcome_money') then return end -- already paid to this license
  character.addCurrency(0, amount) -- 0 = money
  local msg = GetConvar('launcher_reward_message', 'Thanks for playing with the launcher! +$%s')
  Core.NotifyRightTip(src, msg:format(amount), 8000)
  print(('[launcher_reward_vorp] paid $%d to %s (%s)'):format(amount, GetPlayerName(src) or '?', tostring(src)))
end)
