// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 0.76;

function fight(target) {	
	if(character.rip) {respawn(); return;}
	
	if(can_attack(target))
	{
		set_message("Attacking");
		attack(target);
		if(!is_on_cooldown("burst") && target.hp > 3000 && character.mp > 2000)
			use_skill('burst');
		if(!is_on_cooldown("energize") && character.mp > 1200){
			const buffee = getLowestMana();
			if (buffee.max_mp - buffee.mp > 500 && buffee.mp < buffee.max_mp * 0.5) use_skill('energize', buffee);
		}
		if(target['damage_type'] === 'magical' &&  !is_on_cooldown("reflection") && partyMems.includes(target.target) && character.mp > 1000) {
			use_skill('reflection', get_entity(target.target));
		}
		if(character.mp > 100 && !is_on_cooldown("scare") && target.max_hp > 3000 && Object.keys(parent.entities).some(entity => parent.entities[entity]?.target === character.name))
			use_skill('scare');
	}
	
	if (!smartmoveDebug) {
		hitAndRun(target, rangeRate);	
  		angle = angle + flipRotation * Math.asin((character.speed * (1 / character.frequency) / 4) / (character.range * rangeRate)) * 2;
	}
	else {
		angle = undefined;
	}
}

setInterval(function() {
	loot();
	buff();
	
	if(character.rip) {respawn(); return;}
	
	if(smart.moving && !smartmoveDebug) return;
	
	let target = getTarget();
	
	if (goToBoss()) return;
	
	//// EVENTS
	target = changeToDailyEventTargets();
	
	//// Logic to targets and farm places
	if(!smart.moving && !target && !get_entity(partyMems[0])) smart_move({
		map, x: mapX, y: mapY,
	}).catch(e => use_skill('use_town'));
	
	fight(target);
}, (1 / character.frequency) * 1000 / 2);