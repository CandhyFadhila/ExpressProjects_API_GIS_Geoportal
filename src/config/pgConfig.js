require("dotenv").config();

/**
 * getPgConfig
 * Mengembalikan konfigurasi koneksi PostgreSQL berdasarkan PG_ENV
 */
function getPgConfig() {
  const env = process.env.PG_ENV || "windows";

  const configs = {
    windows: {
      host: "localhost",
      port: 5433,
      user: "postgres",
      password: "super.admin",
      database: "geoportal",
    },
    linux: {
      host: "localhost",
      port: 5432,
      user: "gisuser",
      password: "password_kuat",
      database: "geoportal",
    },
  };

  return configs[env] || configs.windows;
}

/**
 * getPgConnectionString
 * Menghasilkan connection string gaya libpq untuk dipakai ogr2ogr
 */
function getPgConnectionString() {
  const cfg = getPgConfig();
  return `host=${cfg.host} user=${cfg.user} dbname=${cfg.database} password=${cfg.password} port=${cfg.port}`;
}

module.exports = {
  getPgConfig,
  getPgConnectionString,
};
