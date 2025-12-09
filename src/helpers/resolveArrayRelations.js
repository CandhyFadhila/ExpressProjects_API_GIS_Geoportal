const knex = require("../config/database");

async function resolveArrayRelations(value, table) {
  if (!value) return [];

  let ids = [];

  // Parse JSON jika belum array
  if (Array.isArray(value)) {
    ids = value;
  } else {
    try {
      ids = JSON.parse(value);
    } catch {
      ids = [];
    }
  }

  if (!ids.length) return [];

  // Ambil data dari tabel (misal: documents) tanpa relasi user
  const results = await knex(table)
    .whereIn("id", ids)
    .select("*");

  // Urutkan sesuai urutan ID input
  const idMap = new Map(results.map((doc) => [doc.id, doc]));
  return ids.map((id) => idMap.get(id)).filter(Boolean);
}

module.exports = { resolveArrayRelations };
