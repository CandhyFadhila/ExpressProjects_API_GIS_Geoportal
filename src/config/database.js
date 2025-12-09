const knex = require("knex");

const db = knex({
  client: "pg",
  connection: {
    host: "localhost",
    port: 5433,
    user: "postgres",
    password: "super.admin",
    database: "gis_bpn_v2",
  },
  pool: {
    min: 2,
    max: 50,
  },
  acquireConnectionTimeout: 10000,
});

module.exports = db;
