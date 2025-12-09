require("dotenv").config();
const express = require("express");
const morgan = require("morgan");
const knex = require("./config/database");
const authRoutes = require("./routes/authRoutes");
const logger = require("./utils/logger");
const path = require("path");
const documentRoutes = require("./routes/documentRoutes");
const workspaceRoutes = require("./routes/Workspaces/workspaceRoutes");
const layersRoutes = require("./routes/Layers/layerRoutes");
const categoriesRoutes = require("./routes/Categories/categoriesRoutes");
const corsMiddleware = require("./middlewares/cors");

const app = express();

// Middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(morgan("dev"));

// Cek API root
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the API Geoserver!" });
});

// Cek db
app.get("/check-db", async (req, res) => {
  try {
    const [metaResult, tablesResult] = await Promise.all([
      knex.raw(`
        SELECT
          current_database() AS database,
          current_schema()   AS schema,
          current_user       AS "user",
          current_setting('port') AS port,
          NOW()              AS server_time
      `),
      knex.raw(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `),
    ]);

    const meta = metaResult.rows[0];
    const tables = tablesResult.rows.map((row) => row.table_name);

    res.json({
      status: "success",
      message: "Koneksi database berhasil.",
      database: meta.database,
      schema: meta.schema,
      user: meta.user,
      port: Number(meta.port),
      server_time: meta.server_time,
      tables_count: tables.length,
      tables,
    });
  } catch (error) {
    logger.error("DB Connection Error:", error.message);
    res.status(500).json({
      status: "error",
      message: "Gagal terhubung ke database.",
      error: error.message,
    });
  }
});

// Route API
app.use("/api", authRoutes);

// Route Documents
app.use("/storage", express.static(path.join(__dirname, "public", "storage")));
app.use("/api/gis-bpn/documents", documentRoutes);

// Gen2
// Route Workspace
app.use("/api/gis-bpn/workspaces", workspaceRoutes);

// Route Layer
app.use("/api/gis-bpn/workspaces-layers", layersRoutes);

// Route Master Data Categories
app.use("/api/gis-bpn/master-data/categories", categoriesRoutes);

// Jalankan server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
