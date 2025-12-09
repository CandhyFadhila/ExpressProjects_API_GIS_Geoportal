const { Client } = require("pg");

async function getPgClientWindows() {
  const client = new Client({
    host: "localhost",
    user: "postgres",
    database: "gis_bpn_v2",
    password: "super.admin",
    port: 5433,
  });

  await client.connect();
  return client;
}

async function getPgClientLinux() {
  const client = new Client({
    host: "localhost",
    user: "gisuser",
    database: "gisdb",
    password: "password_kuat",
    port: 5432,
  });

  await client.connect();
  return client;
}

async function getPgClientByEnv() {
  const env = process.env.PG_ENV || "windows"; // default ke windows
  if (env === "linux") return await getPgClientLinux();
  return await getPgClientWindows();
}

module.exports = {
  getPgClientWindows,
  getPgClientLinux,
  getPgClientByEnv,
};
