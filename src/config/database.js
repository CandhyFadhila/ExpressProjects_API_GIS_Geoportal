const knex = require("knex");
const { getPgConfig } = require("./pgConfig");

const pgConfig = getPgConfig();

const db = knex({
  client: "pg",
  connection: pgConfig,
  pool: {
    min: 2,
    max: 50,
  },
  acquireConnectionTimeout: 10000,
});

module.exports = db;
