// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 1;

function fight(target) {
	if(character.mp > G.skills['charge'].mp && !is_on_cooldown("charge"))
		use_skill('charge');

	if(can_attack(target))
	{
		set_message("Attacking");
		attack(target);

		if(character.mp > G.skills['warcry'].mp && !is_on_cooldown("warcry"))
			use_skill('warcry');

		if (target.target === character.name && character.mp > G.skills['hardshell'].mp && !is_on_cooldown("hardshell") && Object.keys(parent.entities).some(id => parent.entities[id].atk > 500 && partyMems.includes(parent.entities[id].target)))
			use_skill('hardshell')

		if (character.mp > G.skills['taunt'].mp && !is_on_cooldown("taunt")) {
			const mobsTargetingAlly = Object.keys(parent.entities).find(id => partyMems.filter(char => char !== character.name).includes(parent.entities[id]?.target));
			if (mobsTargetingAlly && parent.entities[mobsTargetingAlly]?.attack > 120 && parent.entities[mobsTargetingAlly]?.attack < 1500) use_skill('taunt', parent.entities[mobsTargetingAlly]);
			if (!target.target || target.target !== character.name && target.attack < 1500) {
				use_skill('taunt', parent.entities[mobsTargetingAlly])
			}
		}

		if (character.mp > G.skills['cleave'].mp && !is_on_cooldown("cleave") && Object.keys(parent.entities).filter(id => is_in_range(parent.entities[id], 'cleave')).length > 4)
			use_skill('cleave')

		//if (character.mp > G.skills['stomp'].mp && !is_on_cooldown("stomp"))
		//	use_skill('stomp')

	}
	
	if (!smartmoveDebug) {
		hitAndRun(target, rangeRate);	
  		angle = angle + flipRotation * Math.asin((character.speed * (1 / character.frequency) / 12) / (character.range * rangeRate)) * 2;
	}
	else {
		angle = undefined;
	}
	
	if (target && target.range <= character.range && target.speed > character.speed) {
		rangeRate = target.speed / character.speed;
	}
	else rangeRate = 1;
}

setInterval(function() {
	loot();
	buff();
	
	if(character.rip) {respawn(); return;}

	
	if(smart.moving && !smartmoveDebug) return;
	
	let target = getTarget();
	
	//// BOSSES
	if (goToBoss()) return;
	
	//// EVENTS
	target = changeToDailyEventTargets();
	
	//// Logic to targets and farm places
	if(!smart.moving && !target) smart_move({
		map, x: mapX, y: mapY,
	}).catch(e => use_skill('use_town'));
	
	fight(target);
}, (1 / character.frequency) * 1000 / 6);