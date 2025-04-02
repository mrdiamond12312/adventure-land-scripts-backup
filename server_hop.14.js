const HOP_SERVERS = ["US", "ASIA", "EU"];

const HOME_SERVER = {
  serverRegion: "US",
  serverIdentifier: "I",
};

const tankableBoss = ["snowman", "pinkgoo", "wabbit"];
const bosses = [
  "icegolem",
  "mrpumpkin",
  "mrgreen",
  "franky",
  "crabxx",
  "dragold",
];

const threshold = [
  { type: "icegolem", threshold: 0.7 },
  { type: "mrpumpkin", threshold: 0.95 },
  { type: "mrgreen", threshold: 0.95 },
  { type: "franky", threshold: 0.7 },
  { type: "crabxx", threshold: 1 },
  { type: "dragold", threshold: 0.99 },
];

const API = `https://aldata.earthiverse.ca/monsters/${[
  ...tankableBoss,
  ...bosses,
].join(",")}`;

const currentServer = `${server.region}${server.id}`;
const getHomeServer = () =>
  `${HOME_SERVER.serverRegion}${HOME_SERVER.serverIdentifier}`;

setInterval(async () => {
  if (
    bosses.some(
      (boss) =>
        parent.S[boss] &&
        parent.S[boss].target &&
        parent.S[boss].hp <
          (threshold.find((pair) => pair.type === boss)?.threshold ?? 0.93) *
            parent.S[boss].max_hp
    ) ||
    get("cryptInstance")
  )
    return;

  if (tankableBoss.some((boss) => parent.S[boss]?.live)) return;

  if (parent.S["goobrawl"]?.live && !character.s["hopsickness"]) return;

  const response = await fetch(API);
  if (response.status === 200) {
    // const data = await response.json();

    const data = await response.json();

    if (!data) return;

    const hopAbleServers = data
      .filter(
        (serverBoss) =>
          serverBoss.serverIdentifier !== "PVP" &&
          HOP_SERVERS.includes(serverBoss.serverRegion) &&
          (serverBoss.id || !serverBoss.estimatedRespawn) &&
          (tankableBoss.includes(serverBoss.type) ||
            (bosses.includes(serverBoss.type) && serverBoss.target))
      )
      .sort((lhs, rhs) => {
        const bossPriority = [...tankableBoss, ...bosses];
        return bossPriority.findIndex((boss) => boss === lhs.type) -
          bossPriority.findIndex((boss) => boss === rhs.type)
          ? bossPriority.findIndex((boss) => boss === lhs.type) -
              bossPriority.findIndex((boss) => boss === rhs.type)
          : lhs.hp - rhs.hp;
      });

    if (hopAbleServers && hopAbleServers.length) {
      const toServer = hopAbleServers[0];
      if (
        `${toServer.serverRegion}${toServer.serverIdentifier}` !== currentServer
      ) {
        log(`Hopping to ${toServer.serverRegion}${toServer.serverIdentifier}`);
        change_server(toServer.serverRegion, toServer.serverIdentifier);
      }
      return true;
    }

    if (currentServer !== getHomeServer()) {
      log("Hopping back home server!");
      change_server(HOME_SERVER.serverRegion, HOME_SERVER.serverIdentifier);
    }

    return false;
  }
}, 10000);
