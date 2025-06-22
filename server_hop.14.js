const HOP_SERVERS = ["US", "ASIA", "EU"];

const ignoreServer = [];

const HOME_SERVER = {
  serverRegion: "US",
  serverIdentifier: "III",
};

const tankableBoss = ["snowman", "pinkgoo"];

const bosses = {
  icegolem: { type: "icegolem", threshold: 0.7, hoppable: 0.999 },
  franky: { type: "franky", threshold: 0.7, hoppable: 0.965 },
  mrpumpkin: { type: "mrpumpkin", threshold: 0.7, hoppable: 0.95 },
  mrgreen: { type: "mrgreen", threshold: 0.7, hoppable: 0.95 },
  crabxx: { type: "crabxx", threshold: 0.95, hoppable: 0.9999 },
  dragold: { type: "dragold", threshold: 0.99, hoppable: 1 },
};
const waitForEvent = ["wabbit"];

const API = `https://aldata.earthiverse.ca/monsters/${[
  ...tankableBoss,
  ...Object.keys(bosses),
].join(",")}`;

const currentServer = `${server.region}${server.id}`;
const getHomeServer = () =>
  `${HOME_SERVER.serverRegion}${HOME_SERVER.serverIdentifier}`;

async function hopToServer(serverRegion, serverIdentifier) {
  if (parent.caracAL) {
    parent.caracAL.siblings.forEach((id) => send_cm(id, "loot-before-hopping"));
    await midasLooting(true);
    await sleep(1000);

    Object.keys(caracALconfig.characters)
      .filter((id) => id !== character.name)
      .forEach((id) => parent.caracAL.shutdown(id));

    parent.caracAL.deploy(null, `${serverRegion}${serverIdentifier}`);
  } else {
    partyMems.forEach((id) => send_cm("loot-before-hopping"));
    await midasLooting(true);
    await sleep(1000);

    change_server(serverRegion, serverIdentifier);
  }
}

setInterval(async () => {
  if (
    Object.keys(bosses).some(
      (boss) =>
        parent.S[boss] &&
        parent.S[boss].target &&
        parent.S[boss].hp <
          (bosses[boss]?.threshold ?? 0.93) * parent.S[boss].max_hp,
    ) ||
    get("cryptInstance")
  )
    return;

  if (
    (parent.S["goobrawl"]?.live || parent.S["abtesting"]) &&
    !character.s.hopsickness
  )
    return;

  if (
    tankableBoss.some((boss) => parent.S[boss]?.live) ||
    waitForEvent.some((event) => parent.S[event]?.live)
  )
    return;

  const response = await fetch(API);
  if (response.status === 200) {
    // const data = await response.json();

    const data = await response.json();

    if (!data) return;

    const hopAbleServers = data
      .filter((serverBoss) => {
        return (
          !ignoreServer.includes(
            `${serverBoss.serverRegion}${serverBoss.serverIdentifier}`,
          ) &&
          serverBoss.serverIdentifier !== "PVP" &&
          HOP_SERVERS.includes(serverBoss.serverRegion) &&
          (serverBoss.id || !serverBoss.estimatedRespawn) &&
          (tankableBoss.includes(serverBoss.type) ||
            (Object.keys(bosses).includes(serverBoss.type) &&
              ((serverBoss.hp <
                bosses[serverBoss.type].hoppable *
                  G.monsters[serverBoss.type].hp &&
                serverBoss.target) ||
                bosses[serverBoss.type].hoppable === 1)))
        );
      })
      .sort((lhs, rhs) => {
        const bossPriority = [...tankableBoss, ...Object.keys(bosses)];
        return bossPriority.findIndex((boss) => boss === lhs.type) -
          bossPriority.findIndex((boss) => boss === rhs.type)
          ? bossPriority.findIndex((boss) => boss === lhs.type) -
              bossPriority.findIndex((boss) => boss === rhs.type)
          : lhs.hp - rhs.hp;
      });

    if (hopAbleServers && hopAbleServers.length) {
      const toServer = hopAbleServers.shift();
      if (
        `${toServer.serverRegion}${toServer.serverIdentifier}` !== currentServer
      ) {
        log(`Hopping to ${toServer.serverRegion}${toServer.serverIdentifier}`);
        await hopToServer(toServer.serverRegion, toServer.serverIdentifier);
      }
      return true;
    }

    if (currentServer !== getHomeServer()) {
      log("Hopping back home server!");
      await hopToServer(HOME_SERVER.serverRegion, HOME_SERVER.serverIdentifier);
    }

    return false;
  }
}, 10000);
