// basic_function part: live info shared between our characters, in both clients

const CHARACTER_STATUS_HEARTBEAT_MS = 1000;
const characterInfoCache = {};
let lastStatus = { json: undefined, at: 0 };

/** @returns {Object} the fields every reader can count on */
function characterStatus(entity) {
  return {
    hp: entity.hp,
    max_hp: entity.max_hp,
    mp: entity.mp,
    max_mp: entity.max_mp,
    frequency: entity.frequency,
    explosion: entity.explosion,
    blast: entity.blast,
    map: entity.map,
    in: entity.in,
    x: entity.x,
    y: entity.y,
    rip: entity.rip,
    target: entity.target,
  };
}

/** @param {Object} fields - merged into what this character publishes */
function publishCharacterInfo(fields) {
  parent.characterInfo = { ...parent.characterInfo, ...fields };
  if (parent.caracAL)
    sessionStorage.setItem(
      `info:${character.name}`,
      JSON.stringify(parent.characterInfo),
    );
}

function publishCharacterStatus() {
  const status = characterStatus(character);
  const json = JSON.stringify(status);
  const now = Date.now();
  if (
    json === lastStatus.json &&
    now - lastStatus.at < CHARACTER_STATUS_HEARTBEAT_MS
  )
    return;
  lastStatus = { json, at: now };
  publishCharacterInfo({ ...status, at: now });
}

/**
 * @param {string} name
 * @returns {Object|undefined} what the character published, read-only; `at` is when
 */
function getCharacterInfo(name) {
  if (parent.caracAL) {
    const raw = sessionStorage.getItem(`info:${name}`);
    if (!raw) return undefined;
    if (characterInfoCache[name]?.raw !== raw)
      characterInfoCache[name] = { raw, info: JSON.parse(raw) };
    return characterInfoCache[name].info;
  }

  for (const iframe of top.$("iframe")) {
    const game = iframe.contentWindow;
    if (game.character?.name === name)
      return {
        ...game.characterInfo,
        ...characterStatus(game.character),
        at: Date.now(),
      };
  }
}
