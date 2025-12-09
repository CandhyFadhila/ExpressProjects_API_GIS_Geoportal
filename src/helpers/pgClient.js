const { Client } = require("pg");
const { getPgConfig } = require("../config/pgConfig");

/**
 * getPgClient
 * Membuat dan mengembalikan Client PostgreSQL sesuai PG_ENV
 */
async function getPgClient() {
  const config = getPgConfig();
  const client = new Client(config);
  await client.connect();
  return client;
}

module.exports = {
  getPgClient,
};
