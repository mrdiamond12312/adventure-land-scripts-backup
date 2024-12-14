// Global vars
var attack_mode = true;
var partyMems = ["MooohMoooh", "CowTheMooh", "MowTheCooh"];
var partyCodeSlot = [9, 2, 4, 5]
var partyMerchant = "MerchantMooh";
var buffThreshold = 0.7;

var spacial = 50;

//  run and hit
var last_x = character.real_x;
var last_y = character.real_y;
var last_x2 = last_x; // Keep track of one more back to detect edges better
var last_y2 = last_y; //
var flipRotation = 1;
var flipRotationCooldown = 0;
var angle; // Your desired angle from the monster, in radians
var flip_cooldown = 0;
var stuck_threshold = 2;
var rangeRate = 0.5;

// Monsters selector
var min_xp = 100;
var max_att = 2000;
var bossOffset = 0.99;
var boss = ["mrpumpkin", "mrgreen"];
var map = 'winterland';
var mapX = 73;
var mapY = -909;
var type = "grinch";
var altType1 = "boar";
var altType2 = "boar"

// desired elixir named
var desiredElixir = 'elixirluck';

// Debug stucking
var smartmoveDebug = false;

// Merch boundary
var ignore = ['x0', 'x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'hpot0', 'mpot0', 'cscroll0', 'cscroll1', 'cscroll2', 'scroll0', 'scroll1', 'ornament', 'mistletoe', 'candy1', 'candycane', 'candy0', 'stand0', 'pickaxe', 'rod', 'broom', 'pumpkinspice', 'tracker']
var saleAble = ['cclaw', 'wattire', 'dagger', 'snowball', 'rednose', 'iceskates', 'stinger', 'vitring', 'harmor', 'skullamulet', 'stinger', 'lantern', 'hpbelt', 'hpamulet', 'gphelmet', 'phelmet', 'maceofthedead', 'pmaceofthedead', 'maceofthedead', 'daggerofthedead', 'staffofthedead', 'bowofthedead', 'swordofthedead', 'throwingstars', 'smoke'];
var maxUpgrade = 7;
var maxCompound = 3;

// Bank
const bankSlots = ['items0', 'items1', 'items3'];
// Pre-set function
async function sortInv() {
  var inv = character.items;
  const invLength = inv.length;
  const promises = [];
  for (let i = 0; i < invLength; i++) {
    for (let j = i; j < invLength; j++) {
      const lhs = inv[i];
      const rhs = inv[j];
      if (rhs === null) continue;
      if (lhs === null) {
        const temp = inv[i];
        inv[i] = inv[j];
        inv[j] = temp;
        promises.push(swap(i, j));
        continue;
      }
      if (lhs.name.localeCompare(rhs.name) === -1) {
        const temp = inv[i];
        inv[i] = inv[j];
        inv[j] = temp;
        promises.push(swap(i, j));
        continue;
      }
      if (lhs.name === rhs.name) {
        if ((lhs?.level ?? 0) > (rhs?.level ?? 0)) {
          const temp = inv[i];
          inv[i] = inv[j];
          inv[j] = temp;
          promises.push(swap(i, j));
        };
      }
    }
  }
  return await Promise.all(promises);
}

function isMerchant() {
  return character.ctype === 'merchant';
}

function getMonstersOnDeclares() {
  return (
    get_nearest_monster({ min_xp, max_att, type }) ??
    get_nearest_monster({ min_xp, max_att, type: altType1 }) ?? 
    get_nearest_monster({ min_xp, max_att, type: altType2 })
  );
}

function buff() {
  if (character.hp / character.max_hp < character.mp / character.max_mp || character.hp < character.max_hp * 0.6) {
    if (character.hp < 0.7 * character.max_hp && !is_on_cooldown("use_hp"))
      use_skill("use_hp");
    if (character.hp < character.max_hp - 50 && !is_on_cooldown("regen_hp"))
      use_skill("regen_hp");
  } else {
    if (character.mp < 0.5 * character.max_mp && !is_on_cooldown("use_mp"))
      use_skill("use_mp");
    if (character.mp < character.max_mp - 100 && !is_on_cooldown("regen_mp"))
      use_skill("regen_mp"); 
  }
}

function getTarget() {
  var target = get_targeted_monster();
  
  if (target && !get_nearest_monster({type: target.mtype})) target = undefined;
  
  if (!target) {
    const leader = get_entity(partyMems[0]);
    if (leader)
      target =
        character.name === partyMems[0]
          ? getMonstersOnDeclares()
          : (get_target_of(leader) ?? undefined);
    else target = getMonstersOnDeclares();
    if (target) change_target(target);
    else {
      set_message("No Monsters, move to leader location");
      if (
        leader && !smart.moving &&
        Math.sqrt(
          (character.x - leader.x) * (character.x - leader.x) +
            (character.y - leader.y) * (character.y - leader.y)
        ) > spacial
      )
        xmove(
          character.x + (leader.x - character.x) / 2,
          character.y + (leader.y - character.y) / 2
        );
      return;
    }
  }

  return target;
}

async function leaveJail() {
  if (character.map === "jail" && !smart.moving) {
    smart_move(find_npc("jailer")).then(() => {
      parent.socket.emit("leave");
    });
  }
}

function hitAndRun(target, rangeRate) {
  // If for some reason we have a target but no angle, set the angle
  if (!target) return;
  if (!angle && target) {
    diff_x = character.real_x - target.real_x;
    diff_y = character.real_y - target.real_y;
    angle = Math.atan2(diff_y, diff_x);
  }

  // Calculate the distance we moved since the last iteration
  chx = character.real_x - last_x;
  chy = character.real_y - last_y;
  dist_moved = Math.sqrt(chx * chx + chy * chy);

  // Calculate the distance we moved since the 2nd to last iteration
  chx2 = character.real_x - last_x2;
  chy2 = character.real_y - last_y2;
  dist_moved2 = Math.sqrt(chx2 * chx2 + chy2 * chy2);

  // If the dist_moved is low enough to indicate that we're stuck,
  // rotate our desired angle 45 degrees around the target
  if (dist_moved < stuck_threshold || dist_moved2 < stuck_threshold * 2) {
    if (flipRotationCooldown < 0) {
      flipRotation *= -1;
      flipRotationCooldown = 2;
    }
    angle = angle + flipRotation * Math.PI / 4;
  }

  // Calculate our new desired position. It will be our max attack range
  // from the target, at the angle described by var angle.
  var new_x = target.real_x + character.range * rangeRate * Math.cos(angle);
  var new_y = target.real_y + character.range * rangeRate * Math.sin(angle);
  
  // Save current position and last position
  last_x2 = last_x; // Keep track of one more back to detect edges better
  last_y2 = last_y; //
  last_x = character.real_x;
  last_y = character.real_y;

  // If target gets too close, maybe we're stuck? Flip the rotation some.
  // Has a cooldown after flipping so it doesn't thrash back and forth
  if (flip_cooldown > 18) {
    if (
      parent.distance(character, target) <= character.range * 0.2 * rangeRate
    ) {
      angle = angle + flipRotation * Math.PI * 2 * 0.35;
    }
    flip_cooldown = 0;
  }

  flip_cooldown++;
  flipRotationCooldown--;
  
  move(new_x, new_y);
}

function getLowestHealth() {
  const allies = parent.party_list.map((name) => get_entity(name));
  allies.filter((entity) => entity);
  allies.sort((lhs, rhs) => lhs.hp / lhs.max_hp - rhs.hp / rhs.max_hp);
  return allies[0] || character;
}

function getLowestMana() {
  const allies = parent.party_list.map((name) => get_entity(name));
  allies.filter((entity) => entity);
  allies.sort((lhs, rhs) => lhs.mp / lhs.max_mp - rhs.mp / rhs.max_mp);
  return allies[0] || character;
}

//// RESPAWN
function handle_death() {
  respawn();
}

// BOSS fight functions
function targetBoss(boss) {
  const target = get_nearest_monster({ type: boss });
  if (target) change_target(target);
}

function sleep(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function shouldGoToBoss(mboss) {
  return !boss.includes(getTarget()?.mtype) && parent.S[mboss] && parent.S[mboss].live && ((parent.S[mboss].hp < bossOffset * parent.S[mboss].max_hp && parent.S[mboss].target !== null && !partyMems.includes(parent.S[mboss].target)) || mboss === "snowman");
}

function goToBoss() {
  for (i in boss) {
    if (shouldGoToBoss(boss[i])) {
      log('Attempting boss');
      stop('move');
      change_target();
      smartmoveDebug = false;
      if (!smart.moving) smart_move(parent.S[boss[i]]).then(() => targetBoss(boss[i])).catch(e => { use_skill('use_town'); change_target(); });
      return true;
    }
  }
  return false;
}

//// INVENTORY functions
function item_info(item) {
    return parent.G.items[item.name];
}

async function compoundInv() {
  let inv = character.items;
  
  if(character.q.compound) return;
  
  for (let i = 0; i < inv.length; i++) {
    let breakFlag = false;

    if (inv[i] && (inv[i]?.level > 2 || item_grade(inv[i]) === 2)) continue;

    if (item_info(inv[i]).compound) {
      const scrollType = `cscroll${item_grade(inv[i])}`;
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        buy(scrollType, 1).then(() => {
          scrollSlot = locate_item(scrollType);
        })
        .catch(e => {breakFlag = true;})
      }
      
      if ( character.mp > 20 && !is_on_cooldown("massproduction"))
        use_skill('massproduction')

      if (inv[i] !== null && (new Set([inv[i]?.name, inv[i + 1]?.name, inv[i + 2]?.name])).size === 1 && (new Set([inv[i]?.level, inv[i + 1]?.level, inv[i + 2]?.level])).size === 1)
        compound(i, i + 1, i + 2, scrollSlot)
          .then((e) => {breakFlag = true;})
          .catch((e) => e)
    }
    if (breakFlag) break;
  }
}

async function upgradeInv() {
  let inv = character.items;
  
  if(character.q.upgrade) return;
  
  for (let i = 0; i < inv.length; i++) {
    let breakFlag = false;

    if (inv[i] && (inv[i]?.level > maxUpgrade || item_grade(inv[i]) === 2 || ignore.includes(inv[i].name) )) continue;

    if (item_info(inv[i]).upgrade) {
      const scrollType = `scroll${item_grade(inv[i])}`;
      let scrollSlot = locate_item(scrollType);
      if (scrollSlot === -1) {
        buy(scrollType, 1).then(() => {
          scrollSlot = locate_item(scrollType);
        })
        .catch(e => {breakFlag = true;})
      }
      if ( character.mp > 20 && !is_on_cooldown("massproduction"))
        use_skill('massproduction')
      upgrade(i, scrollSlot)
        .then((e) => {breakFlag = true;})
        .catch((e) => e)
    }
    if (breakFlag) break;
  }
}

function filterCompoundableAndStackable() {
  const inv = character.items;
  const res = Array.from({length: inv.length}, (_, i) => i + 0).filter((i) => inv[i] && (item_info(inv[i]).compound || inv[i].q) && !['hpot1', 'mpot1'].includes(inv[i].name));
  return res;
}

//// Interval threads
// Code Messaging
setInterval(async function(){
  // Xmas buffs
  if (parent.S['holidayseason'] && !character.s.holidayspirit) {
    await smart_move({map: 'main', x: -152, y: -137});
    parent.socket.emit("interaction",{type:"newyear_tree"});
  }

  if (isMerchant()) return;
  
  await sortInv();
  // Fix a bug where character is stuck to corner
  const currentTarget = get_targeted_monster();

  if (currentTarget && !is_in_range(currentTarget, 'attack') && !smart.moving) {
    smartmoveDebug = true;
    smart_move({x: currentTarget.x, y: currentTarget.y}).then(() => { smartmoveDebug = false; }).catch(() => { smartmoveDebug = false; });
  }

  // Re-equip
  if (!character.slots.helmet || saleAble.includes(character.slots.helmet.name)) {
    await equip(character.items.findIndex((item) => !saleAble.includes(item.name) && item_info(item).type === 'helmet' && item.level > 0 ));
  }

  const obj = {
    map: character.map,
    x: character.x,
    y: character.y,
  }
  
  // Merchant buff
  if (!character.s || !character.s.mluck || character.s.mluck.f !== partyMerchant) {
    log('Asking our merchant for some luck!');
    send_cm(partyMerchant, {msg: 'buff_mluck', ...obj})
  }
  
  // Send gold to merchant if he's nearby
  if (get_entity(partyMerchant)) {
    send_gold(partyMerchant, character.gold - 1000000);
  }

  // Inventory check and potions
  if (character.items[41]) {
    log('Inventory full! Calling our merchant!');
    send_cm(partyMerchant, {msg: 'inv_full', ...obj});
  }
  else if (!character.items[40] && locate_item('mpot1') === -1) {
    log('Asking the merchant for some mana potions...');
    send_cm(partyMerchant, {msg: 'buy_mana', ...obj})
  }
  else if (!character.items[40] && locate_item('hpot1') === -1) {
    log('Asking the merchant for some health potions...');
    send_cm(partyMerchant, {msg: 'buy_hp', ...obj})
  }
  else if (!character.slots.elixir || !character.slots.elixir.name) {
    log('Drinking Elixir');

    const elixirSlot = locate_item(desiredElixir)
    
    if (elixirSlot !== -1) {
      consume(elixirSlot);
    }
    else {
      log('No elixir left! Callin our merchant...');
      send_cm(partyMerchant, {msg: 'elixir', ...obj, elixir: desiredElixir});
    }
  }

}, 15000);

// Party Setups
setInterval(function () {
  //// Deploy characters which arent active
  const loadedCharacters = get_active_characters();
  const allCharacters = [...partyMems, partyMerchant];

  if (allCharacters.filter((characterId) => characterId !== character.name).length !== loadedCharacters.length)
    allCharacters.forEach((characterId, index) => {
      if (!loadedCharacters[characterId]) {
        start_character(characterId, partyCodeSlot[index])
      }
    })

  if (partyMems.length !== parent.party_list.length) {
    if (character.name === partyMems[0]) {
      partyMems.map((member) => {
        send_party_invite(member);
      });
    }
  }

  if (character.name !== partyMems[0] && !isMerchant()) {
    const leader = get_entity(partyMems[0]);
    if (leader && get_target_of(leader)) change_target(get_target_of(leader));
  }
  
  leaveJail();
}, 1000);

//// Events listeners
// Party Events
function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
}

//// Game events
async function on_game_event(event) {
  if (isMerchant()) return;
  if (boss.includes(event.name)) {
    log('Attempting boss from game event!');

    const target = getTarget();
    while(!shouldGoToBoss()) {
      await sleep(5000);
    }
    
    stop('move');
    change_target();
    smart_move(parent.S[event.name]).then(() => targetBoss(event.name)).catch(() => change_target());
  }
}

//// Daily Events
function changeToDailyEventTargets() {
  let target = getTarget();
  const isFightingBoss = boss.includes(getTarget()?.mtype);

  if (parent.S.snowman?.live && !isFightingBoss) {
    const snowmanInstance = get_nearest_monster({type: 'snowman'});
    if (!snowmanInstance) smart_move(parent.S.snowman);
    else {
      if (snowmanInstance.s?.fullguardx) change_target(get_nearest_monster({type: 'arcticbee'}));
      else change_target(snowmanInstance);

      return snowmanInstance.s?.fullguardx ? get_nearest_monster({type: 'arcticbee'}) : snowmanInstance;
    }
  } 

  if (parent.S.crabxx?.live && !isFightingBoss) {
    const crabxxInstance = get_nearest_monster({type: 'crabxx'});
    const crabxInstance = get_nearest_monster({type: 'crabx'});
    if (!crabxxInstance)
      join('crabxx');
    if (!target) {
      change_target(crabxInstance || crabxxInstance);
      return crabxInstance || crabxxInstance;
    }
    if (target?.mtype === 'crabxx' && get_nearest_monster({type: 'crabx'})) 
      return crabxInstance
  }
  
  if (parent.S.icegolem?.live && !isFightingBoss && parent.S.icegolem?.hp < 0.9 * parent.S.icegolem?.max_hp && !partyMems.includes(parent.S.icegolem?.target)) {
    const iceGolemInstance = get_nearest_monster({type: 'icegolem'});
    if (!iceGolemInstance) {
      if (character.range < 100) join('icegolem');
      else {
        smart_move({map: 'winterland', x: 771, y: 273});
      }
    }
    change_target(iceGolemInstance);
    return iceGolemInstance;
  }
  else if (get_nearest_monster({type:'icegolem'})) {
    change_target(target);
    return get_nearest_monster({type: 'icegolem'});
  }
  
  if (parent.S.franky && parent.S.franky?.hp < 0.9 * parent.S.franky?.max_hp && !isFightingBoss && !partyMems.includes(parent.S.franky?.target)) {
    const frankyInstance = get_nearest_monster({type:'franky'});
    if (!frankyInstance)
      join('franky');
    change_target(frankyInstance);
    return frankyInstance;
  }

  if (parent.S.abtesting) {
    if (character.map!="abtesting")
      join('abtesting');

    const priority = ['priest', 'mage', 'ranger', 'rogue', 'warrior', 'paladin'];

    let pvpTarget = {
      priority: priority.length + 1,
      entity: undefined,
      sqrDistance: undefined,
    };

    for (id in parent.entities) {
      const currentCharacter = parent.entities[id];

      if (currentCharacter.team === character.team) continue;

      const currentCharacterTarget = {
        priority: priority.findIndex((element) => element === currentCharacter.ctype),
        entity: currentCharacter,
        sqrDistance: Math.pow(currentCharacter.real_x - character.real_x, 2) + Math.pow(currentCharacter.real_y - character.real_y, 2),
      };
      
      if (currentCharacterTarget.priority < pvpTarget.priority) 
        pvpTarget = currentCharacterTarget;

      if (currentCharacterTarget.priority === pvpTarget.priority && currentCharacterTarget.sqrDistance < pvpTarget.sqrDistance)
        pvpTarget = currentCharacterTarget;
    }

    target = pvpTarget.entity;
  }

  if (parent.S.goobrawl && !isFightingBoss){
    if (character.map !== "goobrawl")
      join('goobrawl');

    const rgooInstance = get_nearest_monster({type: 'rgoo'});
    const bgooInstance = get_nearest_monster({type: 'bgoo'});

    if (rgooInstance) {
      change_target(target);
      return get_nearest_monster({type: 'rgoo'});
    }

    if (!(target && ['bgoo', 'rgoo'].includes(target.mtype))) {
      change_target(rgooInstance || bgooInstance);
      return rgooInstance || bgooInstance;
    }
  }
  
  return target;
}
