const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const validator = require("validator");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { blacklistToken } = require("../utils/tokenBlacklist");
const { validationResult } = require("express-validator");
const logger = require("../utils/logger");
const knex = require("../config/database");
const redisClient = require("../config/redisClient");
const WithDataResource = require("../resources/WithDataResource");
const WithoutDataResource = require("../resources/WithoutDataResource");
const renderEmailTemplate = require("../utils/emailOTP/renderEmailTemplate");
const JWT_SECRET = process.env.JWT_SECRET_KEY || "secretkey";
const REFRESH_TOKEN_SECRET =
  process.env.JWT_REFRESH_SECRET_KEY || "refreshsecretkey";
const ACCESS_TOKEN_EXPIRES_IN =
  process.env.JWT_ACCESS_TOKEN_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_IN =
  process.env.JWT_REFRESH_TOKEN_EXPIRES_IN || "7d";

// ========== LOGIN ==========
exports.login = async (req, res) => {
  // Validasi input
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const response = new WithoutDataResource(
      400, // HTTP Status Code: Bad Request
      "VALIDATION_FAILED",
      "Login Gagal.",
      "Tolong periksa kembali input anda. Pastikan email dan password terisi dengan benar."
    );
    return res.status(400).json(response.toResponse());
  }

  const { email, password } = req.body;

  try {
    // Cek user berdasarkan email
    const user = await knex("users").where({ email }).first();
    if (!user) {
      logger.info(
        `| Login | - Invalid credentials for email: ${email}, at ${new Date().toISOString()}`
      );
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "INVALID_CREDENTIALS",
        "Login Gagal.",
        "Password atau email yang anda masukkan tidak valid, silahkan periksa kembali dan pastikan akun anda sudah terdaftar."
      );
      return res.status(400).json(response.toResponse());
    }

    // Verifikasi password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.info(
        `| Login | - Invalid credentials for email: ${email}, at ${new Date().toISOString()}`
      );
      const response = new WithoutDataResource(
        400, // HTTP Status Code: Bad Request
        "INVALID_CREDENTIALS",
        "Login Gagal.",
        "Password atau email yang anda masukkan tidak valid, silahkan periksa kembali dan pastikan akun anda sudah terdaftar."
      );
      return res.status(400).json(response.toResponse());
    }

    const role = await knex("roles").where({ id: user.role_id }).first();

    // Update last_login
    await knex("users")
      .where({ id: user.id })
      .update({ last_login: knex.fn.now() });

    // Create JWT token
    const payload = { userId: user.id };
    const accessToken = generateAccessToken(payload);

    const jti = generateJti();
    const refreshToken = generateRefreshToken({ userId: user.id, jti });
    await storeRefreshToken(user.id, jti, refreshToken);

    // Log successful login
    logger.info(
      `| Login | - Login success for email: ${email}, at ${new Date().toISOString()}`
    );

    // Filter user info (tidak mengirim password)
    const filteredUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      role: role,
      last_login: user.last_login,
    };

    const response = new WithDataResource(
      200, // HTTP Status Code: OK
      "LOGIN_SUCCESS",
      "Login Berhasil.",
      "Selamat datang, anda berhasil login.",
      {
        access_token: accessToken,
        refresh_token: refreshToken,
        user: filteredUser,
      }
    );
    res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Auth | - Error function login: ${error.message}`);
    const response = new WithoutDataResource(
      500, // HTTP Status Code: Internal Server Error
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

// ========== GET USER INFO ==========
exports.getUserInfo = async (req, res) => {
  const userId = req.userId; // Diperoleh dari middleware authMiddleware

  try {
    // Ambil data user dari database berdasarkan userId
    const user = await knex("users").where({ id: userId }).first();
    if (!user) {
      const response = new WithoutDataResource(
        401, // HTTP Status Code: Unauthorized
        "ACCOUNT_NOT_FOUND",
        "Akses Ditolak",
        "Maaf, akun pengguna terkait tidak ditemukan."
      );
      logger.info(`| GetUserInfo | - Account not found for userId: ${userId}`);
      return res.status(401).json(response.toResponse());
    }

    const role = await knex("roles").where({ id: user.role_id }).first();

    // Sembunyikan atribut sensitif, seperti password
    const filteredUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      username: user.username,
      last_login: user.last_login,
      role: role,
    };

    // Log info sukses
    logger.info(
      `| GetUserInfo | - User info fetched for userId: ${userId}, at ${new Date().toISOString()}`
    );

    // Response sukses dengan data pengguna
    const response = new WithDataResource(
      200, // HTTP Status Code: OK
      "SUCCESS_GET_USER_INFO",
      "Berhasil Mendapatkan Data",
      `Data pengguna ${user.name}, berhasil didapatkan.`,
      { user: filteredUser }
    );
    res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Auth | - Error function getUserInfo: ${error.message}`);
    const response = new WithoutDataResource(
      500, // HTTP Status Code: Internal Server Error
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

// ========== LOGOUT ==========
exports.logout = async (req, res) => {
  const userId = req.userId;
  const token = req.header("Authorization")?.replace("Bearer ", "");
  const { refresh_token } = req.body || {};

  try {
    if (!userId) {
      const response = new WithoutDataResource(
        401,
        "NO_ACTIVE_SESSION",
        "Logout Gagal",
        "Anda tidak memiliki sesi login yang aktif."
      );
      logger.info(`| Logout | - No active session for userId: ${userId}`);
      return res.status(401).json(response.toResponse());
    }

    const decoded = jwt.decode(token);
    let expiresIn = 86400;

    if (decoded && decoded.exp) {
      expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      if (expiresIn <= 0) {
        expiresIn = 1;
      }
    }

    await blacklistToken(token, expiresIn);

    if (refresh_token) {
      try {
        const decodedRefresh = jwt.verify(refresh_token, REFRESH_TOKEN_SECRET);
        const { userId: refreshUserId, jti } = decodedRefresh;

        if (refreshUserId && jti) {
          await revokeRefreshToken(refreshUserId, jti);
        }
      } catch (e) {
        logger.info(
          `| Logout | - Invalid refresh token supplied during logout`
        );
      }
    }

    logger.info(
      `| Logout | - Logout success for userId: ${userId}, at ${new Date().toISOString()}`
    );

    const response = new WithoutDataResource(
      200,
      "LOGOUT_SUCCESS",
      "Logout Berhasil",
      "Anda berhasil melakukan logout."
    );
    res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Auth | - Error function logout: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

// ========== SEND OTP ==========
exports.sendOTP = async (req, res) => {
  const { email } = req.body;

  if (!email || !validator.isEmail(email)) {
    const response = new WithoutDataResource(
      400,
      "VALIDATION_FAILED",
      "Pengiriman OTP Gagal",
      "Email tidak valid atau kosong. Pastikan Anda mengisi email dengan benar."
    );
    return res.status(400).json(response.toResponse());
  }

  try {
    const user = await knex("users")
      .select("id", "name")
      .where({ email })
      .first();
    if (!user) {
      const response = new WithoutDataResource(
        404,
        "DATA_NOT_FOUND",
        "Akun Tidak Ditemukan",
        `Akun dengan email '${email}' tidak ditemukan.`
      );
      return res.status(404).json(response.toResponse());
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const key = `otp:${user.id}`;
    const hash = crypto.createHash("sha256").update(otp).digest("hex");

    await redisClient.setEx(key, 1800, hash); // expire in 30 minutes

    const htmlBody = renderEmailTemplate("otp.html", {
      name: user.name,
      otp: otp,
    });

    const transporter = nodemailer.createTransport({
      service: "Gmail",
      auth: {
        user: process.env.MAIL_USERNAME,
        pass: process.env.MAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"GIS" <${process.env.MAIL_USERNAME}>`,
      to: email,
      subject: "Verifikasi Kode OTP Perubahan Password",
      html: htmlBody,
    });

    logger.info(
      `| Send OTP | - OTP sent to ${email} at ${new Date().toISOString()}`
    );
    const response = new WithoutDataResource(
      200,
      "OTP_SENT",
      "Berhasil Mengirim Kode OTP",
      "Kode OTP berhasil dikirim. Silakan cek email Anda."
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Auth | - Error function sendOTP: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

// ========== VERIFY OTP ==========
exports.verifyOTP = async (req, res) => {
  const { email, otp } = req.body;

  try {
    const user = await knex("users")
      .select("id", "email")
      .where({ email })
      .first();
    if (!user) {
      const response = new WithoutDataResource(
        404,
        "DATA_NOT_FOUND",
        "Akun Tidak Ditemukan",
        `Akun dengan email '${email}' tidak ditemukan.`
      );
      return res.status(404).json(response.toResponse());
    }

    const key = `otp:${user.id}`;
    const storedHashedOtp = await redisClient.get(key);

    if (!storedHashedOtp) {
      logger.info(`| Verify OTP | - OTP not found for user ${email}`);
      const response = new WithoutDataResource(
        400,
        "DATA_NOT_FOUND",
        "OTP Tidak Ditemukan",
        "Kode OTP tidak ditemukan atau sudah kadaluarsa. Silakan kirim ulang OTP."
      );
      return res.status(400).json(response.toResponse());
    }

    const hash = crypto.createHash("sha256").update(String(otp)).digest("hex");

    if (hash !== storedHashedOtp) {
      logger.info(`| Verify OTP | - Incorrect OTP for user ${email}`);
      const response = new WithoutDataResource(
        400,
        "INVALID_OTP",
        "OTP Tidak Valid",
        "Kode OTP yang anda masukkan tidak sesuai."
      );
      return res.status(400).json(response.toResponse());
    }

    logger.info(`| Verify OTP | - Success for user ${email}`);

    const response = new WithoutDataResource(
      200,
      "OTP_VERIFIED",
      "OTP Berhasil Diverifikasi",
      "Kode OTP anda berhasil diverifikasi. Silakan lanjutkan reset password."
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Auth | - Error function verifyOTP: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

// ========== RESET PASSWORD ==========
exports.resetPassword = async (req, res) => {
  const { email, otp, password } = req.body;

  try {
    // Cari user
    const user = await knex("users")
      .select("id", "email")
      .where({ email })
      .first();
    if (!user) {
      const response = new WithoutDataResource(
        404,
        "DATA_NOT_FOUND",
        "Akun Tidak Ditemukan",
        `Akun dengan email '${email}' tidak ditemukan.`
      );
      return res.status(404).json(response.toResponse());
    }

    const key = `otp:${user.id}`;
    const storedHashedOtp = await redisClient.get(key);

    if (!storedHashedOtp) {
      const response = new WithoutDataResource(
        400,
        "OTP_NOT_FOUND",
        "OTP Tidak Ditemukan",
        "Kode OTP tidak ditemukan atau sudah kadaluarsa. Silakan kirim ulang OTP."
      );
      return res.status(400).json(response.toResponse());
    }

    const hashedInputOtp = crypto
      .createHash("sha256")
      .update(String(otp))
      .digest("hex");

    if (hashedInputOtp !== storedHashedOtp) {
      const response = new WithoutDataResource(
        401,
        "INVALID_OTP",
        "OTP Tidak Valid",
        "Kode OTP yang anda masukkan salah. Silakan coba lagi atau kirim ulang OTP."
      );
      return res.status(401).json(response.toResponse());
    }

    // Update password
    const hashedPassword = await bcrypt.hash(password, 10);
    await knex("users").where({ id: user.id }).update({
      password: hashedPassword,
      last_change_password: knex.fn.now(),
    });

    // Hapus OTP dari Redis
    await redisClient.del(key);

    logger.info(`| Reset Password | - Success for email: ${email}`);

    const response = new WithoutDataResource(
      200,
      "PASSWORD_RESET_SUCCESS",
      "Password Berhasil Diubah",
      "Password anda berhasil diubah. Silakan login menggunakan password baru anda."
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Auth | - Error function resetPassword: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

// ========== REFRESH TOKEN ==========
exports.refreshToken = async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
    const response = new WithoutDataResource(
      422,
      "REFRESH_TOKEN_REQUIRED",
      "Validasi Gagal",
      "Refresh token tidak ditemukan. Silakan masukkan refresh token terlebih dahulu."
    );
    return res.status(401).json(response.toResponse());
  }

  jwt.verify(refresh_token, REFRESH_TOKEN_SECRET, async (err, decoded) => {
    if (err && err.name === "TokenExpiredError") {
      const response = new WithoutDataResource(
        401,
        "REFRESH_TOKEN_EXPIRED",
        "Akses ditolak",
        "Refresh token sudah kedaluwarsa. Silakan login kembali."
      );
      logger.info(
        `| RefreshToken | - Refresh token expired at ${new Date().toISOString()}`
      );
      return res.status(401).json(response.toResponse());
    }

    if (err) {
      const response = new WithoutDataResource(
        401,
        "INVALID_REFRESH_TOKEN",
        "Akses ditolak",
        "Refresh token tidak valid. Silakan login kembali."
      );
      logger.info(
        `| RefreshToken | - Invalid refresh token at ${new Date().toISOString()}`
      );
      return res.status(401).json(response.toResponse());
    }

    const { userId, jti } = decoded;

    try {
      const stored = await isStoredRefreshToken(userId, jti);
      if (!stored) {
        const response = new WithoutDataResource(
          401,
          "REFRESH_TOKEN_REVOKED",
          "Akses ditolak",
          "Refresh token sudah tidak berlaku. Silakan login kembali."
        );
        logger.info(
          `| RefreshToken | - Refresh token revoked for userId: ${userId}`
        );
        return res.status(401).json(response.toResponse());
      }

      const user = await knex("users").where({ id: userId }).first();
      if (!user) {
        const response = new WithoutDataResource(
          401,
          "ACCOUNT_NOT_FOUND",
          "Akses ditolak",
          "Akun pengguna tidak ditemukan."
        );
        logger.info(
          `| RefreshToken | - Account not found for userId: ${userId}`
        );
        return res.status(401).json(response.toResponse());
      }

      const lastLogin = new Date(user.last_login);
      const now = new Date();
      const diffInDays = Math.floor((now - lastLogin) / (1000 * 60 * 60 * 24));

      if (diffInDays > 3) {
        await revokeRefreshToken(userId, jti);

        const response = new WithoutDataResource(
          401,
          "LOGIN_EXPIRED",
          "Akses ditolak",
          "Anda belum login dalam 3 hari terakhir. Silakan login kembali."
        );
        logger.info(
          `| RefreshToken | - Login expired for userId: ${userId} (idle > 3 hari)`
        );
        return res.status(401).json(response.toResponse());
      }

      const payload = { userId };
      const accessToken = generateAccessToken(payload);

      const newJti = generateJti();
      const newRefreshToken = generateRefreshToken({
        userId,
        jti: newJti,
      });

      await revokeRefreshToken(userId, jti);
      await storeRefreshToken(userId, newJti, newRefreshToken);

      logger.info(
        `| RefreshToken | - Token refreshed for userId: ${userId}, at ${new Date().toISOString()}`
      );

      const response = new WithDataResource(
        200,
        "TOKEN_REFRESH_SUCCESS",
        "Token Berhasil Diperbarui",
        "Token akses berhasil diperbarui.",
        {
          access_token: accessToken,
          refresh_token: newRefreshToken,
        }
      );
      return res.status(200).json(response.toResponse());
    } catch (error) {
      logger.error(`| Auth | - Error function refreshToken: ${error.message}`);
      const response = new WithoutDataResource(
        500,
        "SERVER_ERROR",
        "Server Sedang Error",
        "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
      );
      return res.status(500).json(response.toResponse());
    }
  });
};

/** generateAccessToken creates a short-lived JWT access token for the given payload. */
const generateAccessToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });

/** generateRefreshToken creates a long-lived JWT refresh token with jti for the given payload. */
const generateRefreshToken = (payload) =>
  jwt.sign(payload, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  });

/** generateJti creates a random unique id for refresh tokens. */
const generateJti = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

/** storeRefreshToken saves a refresh token identifier in Redis with its remaining lifetime. */
const storeRefreshToken = async (userId, jti, refreshToken) => {
  const decoded = jwt.decode(refreshToken);
  if (!decoded || !decoded.exp) return;

  const expiresInSeconds = decoded.exp - Math.floor(Date.now() / 1000);
  if (expiresInSeconds <= 0) return;

  const key = `refresh_token:${userId}:${jti}`;
  await redisClient.setEx(key, expiresInSeconds, "1");
};

/** revokeRefreshToken removes a specific refresh token from Redis by userId and jti. */
const revokeRefreshToken = async (userId, jti) => {
  const key = `refresh_token:${userId}:${jti}`;
  await redisClient.del(key);
};

/** isStoredRefreshToken checks whether a refresh token identifier is still stored in Redis. */
const isStoredRefreshToken = async (userId, jti) => {
  const key = `refresh_token:${userId}:${jti}`;
  const value = await redisClient.get(key);
  return !!value;
};
