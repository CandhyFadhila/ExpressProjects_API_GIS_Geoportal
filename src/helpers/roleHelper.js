const knex = require("../config/database");
const logger = require("../utils/logger");

/**
 * Cek apakah userId adalah super admin (role_id === 1).
 * Selalu mengembalikan boolean; jika terjadi error, kembalikan false.
 */
async function isSuperAdmin(userId) {
  if (!userId) return false;
  try {
    const row = await knex("users")
      .select("role_id")
      .where({ id: userId })
      .first();

    return Number(row?.role_id) === 1;
  } catch (err) {
    logger.error(
      `| Role Helper | - Gagal cek super admin untuk userId=${userId}: ${err.message}`
    );
    return false;
  }
}

/**
 * Convenience wrapper: baca req.userId dari authMiddleware.
 * Jika tersedia req.userRoleId (opsional, lihat catatan optimasi di bawah),
 * gunakan itu agar tidak query DB lagi.
 */
async function isSuperAdminFromRequest(req) {
  if (!req) return false;
  if (req.userRoleId != null) return Number(req.userRoleId) === 1;
  return isSuperAdmin(req.userId);
}

module.exports = { isSuperAdmin, isSuperAdminFromRequest };
