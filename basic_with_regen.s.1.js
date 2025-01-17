// Hey there!
// This is CODE, lets you control your character with code.
// If you don't know how to code, don't worry, It's easy.
// Just set attack_mode to true and ENGAGE!

// Global Vars
var attack_mode = true;
var partyMems = ["MoohThatCow", "CowTheMooh", "MowTheCooh"];

var spacial = 50;

//  run and hit
var last_x = character.real_x;
var last_y = character.real_y;
var last_x2 = last_x; // Keep track of one more back to detect edges better
var last_y2 = last_y; //
var angle; // Your desired angle from the monster, in radians
var flip_cooldown = 0;
var stuck_threshold = 2;

// Monsters selector
var min_xp = 1500;
var max_att = 50;
var type = "squigtoad";

var sort = true;

function sortInv() {
  var inv = character.items;
  const invLength = inv.length;

  for (let i = 0; i < invLength; i++) {
    for (let j = i; j < invLength; j++) {
      const lhs = inv[i];
      const rhs = inv[j];
      if (rhs === null) continue;
      if (lhs === null && rhs) swap(i, j);
      if (lhs.name.localeCompare(rhs.name) == 1) swap(i, j);
    }
  }
}

setInterval(function () {
  var inv = character.items;
  const invLength = inv.length;

  for (let i = 0; i < inv.length; i++) {
    compound(i, i + 1, i + 2, locate_item("cscroll0"));
  }
}, 5000);

function on_party_invite(name) {
  if (name === partyMems[0]) accept_party_invite(name);
} // called by the inviter's name

function handle_death() {
  respawn();
}

// Learn Javascript: https://www.codecademy.com/learn/introduction-to-javascript
// Write your own CODE: https://github.com/kaansoral/adventureland
