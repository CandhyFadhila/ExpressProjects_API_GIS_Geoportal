const jwt = require("jsonwebtoken");
const WithoutDataResource = require("../resources/WithoutDataResource");
const { isTokenBlacklisted, blacklistToken } = require("../utils/tokenBlacklist");
const logger = require("../utils/logger");
const knex = require("../config/database");
const JWT_SECRET = process.env.JWT_SECRET_KEY || "secretkey";

// Middleware untuk autentikasi menggunakan JWT
const authMiddleware = async (req, res, next) => {
  // Ambil token dari header Authorization
  const token = req.header("Authorization")?.replace("Bearer ", "");

  // Jika tidak ada token
  if (!token) {
    const response = new WithoutDataResource(
      401, // HTTP Status Code: Unauthorized
      "TOKEN_NOT_FOUND",
      "Akses ditolak",
      "Token tidak ditemukan. Pastikan Anda sudah login dan menyertakan token dalam header request."
    );
    logger.info(
      `| Auth | - Token tidak ditemukan di request, at ${new Date().toISOString()}`
    );
    return res.status(401).json(response.toResponse());
  }

  // Cek apakah token sudah di-blacklist
  const blacklisted = await isTokenBlacklisted(token);
  if (blacklisted) {
    const response = new WithoutDataResource(
      401,
      "TOKEN_BLACKLISTED",
      "Akses ditolak",
      "Sesi login Anda telah berakhir. Silakan login kembali."
    );
    return res.status(401).json(response.toResponse());
  }

  // Verifikasi token
  jwt.verify(token, JWT_SECRET, async (err, decoded) => {
    if (err && err.name === "TokenExpiredError") {
      const response = new WithoutDataResource(
        401, // HTTP Status Code: Unauthorized
        "TOKEN_EXPIRED",
        "Akses ditolak",
        "Token sudah kedaluwarsa. Silakan login kembali."
      );
      logger.info(
        `| Auth | - Token expired for user with token: ${token}, at ${new Date().toISOString()}`
      );
      return res.status(401).json(response.toResponse());
    }

    if (err) {
      const response = new WithoutDataResource(
        401, // HTTP Status Code: Unauthorized
        "INVALID_TOKEN",
        "Akses ditolak",
        "Token tidak valid. Silakan login kembali."
      );
      logger.info(`| Auth | - Invalid token, at ${new Date().toISOString()}`);
      return res.status(401).json(response.toResponse());
    }

    // Fungsi untuk cek last_login. jika lebih dari 3 hari, maka login ulang dan token di blacklist
    const userId = decoded.userId;

    try {
      const user = await knex("users").where({ id: userId }).first();
      if (!user || !user.last_login) {
        const response = new WithoutDataResource(
          401,
          "USER_NOT_FOUND_OR_NOT_LOGGED_IN",
          "Akses ditolak",
          "Pengguna tidak ditemukan atau belum login."
        );
        return res.status(401).json(response.toResponse());
      }

      const lastLogin = new Date(user.last_login);
      const now = new Date();
      const diffInDays = Math.floor((now - lastLogin) / (1000 * 60 * 60 * 24));

      if (diffInDays > 3) {
        // Masukkan token ke blacklist Redis
        await blacklistToken(token, 86400); // expired dalam 1 hari

        const response = new WithoutDataResource(
          401,
          "LOGIN_EXPIRED",
          "Akses ditolak",
          "Anda belum login dalam 3 hari terakhir. Silakan login kembali."
        );
        logger.info(`| Auth | - Token valid tapi user idle > 3 hari`);
        return res.status(401).json(response.toResponse());
      }

      req.userId = userId;
      logger.info(
        `| Auth | - Token valid for userId: ${
          decoded.userId
        }, at ${new Date().toISOString()}`
      );
      next();
    } catch (error) {
      logger.error(`| Auth | - Gagal mengecek last_login: ${error.message}`);
      const response = new WithoutDataResource(
        500, // HTTP Status Code: Internal Server Error
        "SERVER_ERROR",
        "Server Sedang Error",
        "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
      );
      res.status(500).json(response.toResponse());
    }
  });
};

module.exports = authMiddleware;
