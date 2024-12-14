// Load basic functions from other code snippet
load_code(7);
load_code(8);

// Kiting
var rangeRate = 0.5;

function fight(target) {
	if(can_attack(target))
	{
		set_message("Attacking");
		attack(target);
		if(character.mp > 1100 && !is_on_cooldown("curse") && target.max_hp > 3000)
			use_skill('curse', target);
		
		if(target && !is_on_cooldown('darkblessing') && character.mp > G.skills['darkblessing'].mp && !character.s?.darkblessing)
			use_skill('darkblessing')
	}
	
	if (!smartmoveDebug) {
		hitAndRun(target, rangeRate);	
  		angle = angle + flipRotation * Math.asin((character.speed * (1 / character.frequency) / 4) / (character.range * rangeRate)) * 2;
	}
	else {
		angle = undefined;
	}
}

function priestBuff() {
	const buffee = getLowestHealth();
	if (buffee.hp < buffee.max_hp - buffThreshold * character.heal) {
		if(!is_in_range(buffee, 'heal')) move(buffee.x, buffee.y);
		if(!is_on_cooldown("heal")) {
			log('heal')
			use_skill('heal', buffee);

			set_message('Heal' + buffee.name);
		}
	}
	
	const allies = parent.party_list.map((name) => get_entity(name)).filter(e => e);
	if (allies && (allies.some(ally => ally.hp < (ally.max_hp - character.level * 10) && !is_in_range(ally, 'heal')) || allies.every(ally => ally.hp < (ally.max_hp - character.level * 10))))
		if(is_in_range(buffee,"partyheal") && !is_on_cooldown("partyheal") && character.mp > 500) {
			use_skill('partyheal', buffee);

			set_message('Heal' + buffee.name);
		}

	partyMems.filter((member) => member !== character.name).map(member => {
		if (Object.keys(parent.entities).some(entity => parent.entities[entity]?.target === member))
			if (is_in_range(get_entity(member),"absorb") 
				&& !is_on_cooldown("absorb")
				&& character.mp > G.skills['absorb'].mp 
				&& (get_entity(member).ctype !== 'warrior' 
					|| Object.keys(parent.entities).filter(entity => parent.entities[entity]?.target === member).length > 2)) {
				use_skill('absorb', get_entity(member));

				set_message('Absorb ' + member);
			}
	})

	if(character.mp > 50 && !is_on_cooldown("scare") && Object.keys(parent.entities).some(entity => parent.entities[entity]?.target === character.name))
		use_skill('scare');
}

setInterval(function() {
	loot();
	buff();
	
	if(character.rip) {respawn(); return;}
	
	priestBuff();
	
	if(smart.moving && !smartmoveDebug) return;
	
	let target = getTarget();
	
	//// BOSSES
	if (goToBoss()) return;
	
	//// EVENTS
	target = changeToDailyEventTargets();
	
	//// Logic to targets and farm places
	if(!smart.moving && !target && !get_entity(partyMems[0])) smart_move({
		map, x: mapX, y: mapY,
	}).catch(e => use_skill('use_town'));
	
	fight(target);
}, (1 / character.frequency) * 1000 / 2);