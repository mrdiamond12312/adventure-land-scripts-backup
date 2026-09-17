// Keeps this character beside the one you are steering.
// Shaped after earthiverse/adventureland-bots vanilla_scripts/cave.

/** The character you are driving in the client */
const LEADER = "MooohMoooh";

/** Where each follower stands, by position in the party list */
const FOLLOW_OFFSETS = [
  { x: 0, y: 0 },
  { x: -25, y: 0 },
  { x: 25, y: 0 },
  { x: 0, y: 25 },
  { x: 0, y: -25 },
];

async function moveLoop() {
  try {
    // Nearby gives live coordinates, the party object is the stale fallback
    const leader = parent.entities[LEADER] ?? get_party()[LEADER];
    if (!leader) return;

    const index = (parent.party_list ?? []).indexOf(character.name);
    if (index <= 0) return;

    const offset = FOLLOW_OFFSETS[index];
    if (!offset) return;

    await smart_move({
      map: leader.map,
      x: leader.x + offset.x,
      y: leader.y + offset.y,
    });
  } catch (error) {
    console.error(error);
  } finally {
    setTimeout(moveLoop, 250);
  }
}

moveLoop();
