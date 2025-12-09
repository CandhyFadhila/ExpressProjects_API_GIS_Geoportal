const knex = require("../config/database");
const WithoutDataResource = require("../resources/WithoutDataResource");
const logger = require("../utils/logger");

const ROLES = {
  SUPER_ADMIN: "super_admin",
  REGULER: "reguler",
  VIEWER: "viewer",
};

// Pemetaan id → slug (sesuai requirement baru)
const ROLE_ID_TO_SLUG = {
  1: ROLES.SUPER_ADMIN,
  2: ROLES.REGULER,
  3: ROLES.VIEWER,
};

// Normalisasi name → slug (contoh: "Super Admin" -> "super_admin")
function roleNameToSlug(name) {
  const slugged = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  // alias lama/umum
  if (slugged === "user") return ROLES.REGULER; // backward-compat
  return slugged;
}

// Normalisasi id → slug
function roleIdToSlug(id) {
  const n = Number(id);
  return ROLE_ID_TO_SLUG[n] || null;
}

// Normalisasi input allowedRoles: bisa string | number | array campuran
function normalizeAllowed(allowed) {
  const set = new Set();
  if (allowed == null) return set;

  const pushOne = (val) => {
    if (typeof val === "number") {
      const slug = roleIdToSlug(val);
      if (slug) set.add(slug);
      return;
    }
    // string: bisa slug atau name
    const slug = roleNameToSlug(val);
    if (slug) set.add(slug);
  };

  if (Array.isArray(allowed)) {
    allowed.forEach(pushOne);
  } else {
    pushOne(allowed);
  }

  return set;
}

function roleMiddleware(allowedRoles) {
  const allowed = normalizeAllowed(allowedRoles);

  return async function (req, res, next) {
    try {
      const userId = req.userId; // diset oleh authMiddleware
      if (!userId) {
        const response = new WithoutDataResource(
          401,
          "UNAUTHENTICATED",
          "Akses ditolak",
          "Anda belum terautentikasi."
        );
        return res.status(401).json(response.toResponse());
      }

      // Ambil role user
      let roleRow;
      if (req.userRoleId != null && req.userRoleName) {
        roleRow = { id: req.userRoleId, name: req.userRoleName };
      } else if (req.userRoleId != null) {
        roleRow = await knex("roles")
          .select("id", "name")
          .where("id", req.userRoleId)
          .first();
      } else {
        roleRow = await knex("users as u")
          .leftJoin("roles as r", "r.id", "u.role_id")
          .where("u.id", userId)
          .select("u.role_id as id", "r.name")
          .first();
      }

      if (!roleRow || !roleRow.name || !roleRow.id) {
        const response = new WithoutDataResource(
          403,
          "NO_ACCESS",
          "Akses ditolak",
          "Anda tidak memiliki hak akses untuk melakukan proses ini."
        );
        logger.info(`| Role | - Role tidak ditemukan untuk userId=${userId}`);
        return res.status(403).json(response.toResponse());
      }

      const roleSlugFromId = roleIdToSlug(roleRow.id);
      const roleSlugFromName = roleNameToSlug(roleRow.name);
      // Prefer slug dari ID (paling tegas), fallback ke name
      const roleSlug = roleSlugFromId || roleSlugFromName;

      // Tempel ke req
      req.userRoleId = roleRow.id;
      req.userRoleName = roleRow.name;
      req.userRoleSlug = roleSlug;

      // Daftar allowed kosong -> tidak ada yang boleh (fail-safe)
      if (allowed.size === 0) {
        const response = new WithoutDataResource(
          403,
          "NO_ACCESS",
          "Akses ditolak",
          "Anda tidak memiliki hak akses untuk melakukan proses ini."
        );
        return res.status(403).json(response.toResponse());
      }

      // Cek apakah role user termasuk yang diizinkan
      if (!allowed.has(roleSlug)) {
        const response = new WithoutDataResource(
          403,
          "NO_ACCESS",
          "Akses ditolak",
          "Anda tidak memiliki hak akses untuk melakukan proses ini."
        );
        logger.info(
          `| Role | - Ditolak role=${roleSlug}, allowed=[${[...allowed].join(
            ", "
          )}], userId=${userId}`
        );
        return res.status(403).json(response.toResponse());
      }

      // Lolos
      return next();
    } catch (err) {
      logger.error(`| Role | - Error roleMiddleware: ${err.message}`);
      const response = new WithoutDataResource(
        500,
        "SERVER_ERROR",
        "Server Sedang Error",
        "Terjadi kesalahan pada sistem, silakan coba lagi nanti atau hubungi admin."
      );
      return res.status(500).json(response.toResponse());
    }
  };
}

module.exports = {
  roleMiddleware,
  ROLES,
  roleNameToSlug,
  roleIdToSlug,
};
