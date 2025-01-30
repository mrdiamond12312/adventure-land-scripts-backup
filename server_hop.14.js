const HOP_SERVERS = ["US", "ASIA", "EU"];

const API = "https://aldata.earthiverse.ca/lunarnewyear";

const HOME_SERVER = {
  serverRegion: "US",
  serverIdentifier: "I",
};

const currentServer = `${server.region}${server.id}`;
const getHomeServer = () =>
  `${HOME_SERVER.serverRegion}${HOME_SERVER.serverIdentifier}`;

setInterval(async () => {
  if (["franky", "snowman", "icegolem", "crabxx"].some((boss) => shouldGoToBoss(boss)))
    return;

  const response = await fetch(API);
  if (response.status === 200) {
    // const data = await response.json();

    const data = await response.json();

    if (!data) return;

    const hopAbleServers = data.filter(
      (serverBoss) =>
        serverBoss.target && HOP_SERVERS.includes(serverBoss.serverRegion)
    );

    if (hopAbleServers && hopAbleServers.length) {
      if (
        !hopAbleServers
          .map((server) => `${server.serverRegion}${server.serverIdentifier}`)
          .includes(currentServer)
      ) {
        log(
          `Hopping to ${hopAbleServers[0].serverRegion}${hopAbleServers[0].serverIdentifier}`
        );
        change_server(
          hopAbleServers[0].serverRegion,
          hopAbleServers[0].serverIdentifier
        );
      }
    } else {
      if (currentServer !== getHomeServer()) {
        log("Hopping back home server!");
        change_server(HOME_SERVER.serverRegion, HOME_SERVER.serverIdentifier);
      }
    }
  }
}, 20000);
