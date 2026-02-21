const HOP_SERVERS = ["US", "ASIA", "EU"];

const ignoreServer = [];

const HOME_SERVER = {
  serverRegion: "US",
  serverIdentifier: "II",
};

const tankableBoss = ["snowman"];

const bosses = {
  grinch: { type: "grinch", threshold: 0.7, hoppable: 1 },
  icegolem: { type: "icegolem", threshold: 0.9, hoppable: 1 },
  franky: { type: "franky", threshold: 0.75, hoppable: 1 },
  mrpumpkin: { type: "mrpumpkin", threshold: 0.3, hoppable: 0.9999 },
  mrgreen: { type: "mrgreen", threshold: 0.3, hoppable: 0.9999 },
  crabxx: { type: "crabxx", threshold: 0.95, hoppable: 1 },
  dragold: { type: "dragold", threshold: 0.85, hoppable: 1 },
  pinkgoo: { type: "pinkgoo", threshold: 0.65, hoppable: 1 },
};
const waitForEvent = ["wabbit"];

const API = `https://aldata.earthiverse.ca/monsters/${[
  ...tankableBoss,
  ...Object.keys(bosses),
].join(",")}`;

const currentServer = `${server.region}${server.id}`;
const getHomeServer = () =>
  `${HOME_SERVER.serverRegion}${HOME_SERVER.serverIdentifier}`;

const isAtHomeServer = () => currentServer === getHomeServer();

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
        (parent.S[boss].target ||
          bosses[boss].hoppable === 1 ||
          ["pinkgoo"].includes(bosses[boss].type)) &&
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

    // Way around to add bosses that are flickering and bugged in the API
    if (parent.S.grinch?.live && data.constructor === Array) {
      data.push({
        ...parent.S.grinch,
        id: 1,
        type: "grinch",
        serverIdentifier: server.id,
        serverRegion: server.region,
      });
    }

    if (parent.S.pinkgoo?.live && data.constructor === Array) {
      data.push({
        ...parent.S.pinkgoo,
        id: 1,
        type: "pinkgoo",
        serverIdentifier: server.id,
        serverRegion: server.region,
      });
    }

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
        const lhsIsTankable = tankableBoss.includes(lhs.type);
        const rhsIsTankable = tankableBoss.includes(rhs.type);

        if (lhsIsTankable !== rhsIsTankable) {
          return rhsIsTankable - lhsIsTankable;
        }

        return (
          lhs.hp / G.monsters[lhs.type].hp - rhs.hp / G.monsters[rhs.type].hp
        );
        // return bossPriority.findIndex((boss) => boss === lhs.type) -
        //   bossPriority.findIndex((boss) => boss === rhs.type)
        //   ? bossPriority.findIndex((boss) => boss === lhs.type) -
        //       bossPriority.findIndex((boss) => boss === rhs.type)
        //   :
        //   lhs.hp / G.monsters[lhs.type].hp - rhs.hp / G.monsters[rhs.type].hp;
      });

    if (hopAbleServers && hopAbleServers.length) {
      console.log(
        hopAbleServers.map(
          (server) =>
            `${server.serverRegion}${server.serverIdentifier} ${server.type} ${server.hp}`,
        ),
      );
      const toServer = hopAbleServers.shift();
      if (
        `${toServer.serverRegion}${toServer.serverIdentifier}` !== currentServer
      ) {
        log(`Hopping to ${toServer.serverRegion}${toServer.serverIdentifier}`);
        set("currentParty", undefined);
        await hopToServer(toServer.serverRegion, toServer.serverIdentifier);
      }
      return true;
    }

    if (!isAtHomeServer()) {
      log("Hopping back home server!");
      set("currentParty", undefined);
      await hopToServer(HOME_SERVER.serverRegion, HOME_SERVER.serverIdentifier);
    }

    return false;
  }
}, 10000);
