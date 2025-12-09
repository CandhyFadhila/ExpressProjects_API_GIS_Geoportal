const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const WithoutDataResource = require("../resources/WithoutDataResource");
const logger = require("../utils/logger");

// Bikin sekali saat aplikasi di-start
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 50, // Maksimal 50 request per window
  keyGenerator: ipKeyGenerator, // ✅ wajib untuk keamanan IPv6
  standardHeaders: true,
  legacyHeaders: false,

  message: () => {
    return new WithoutDataResource(
      429,
      "TOO_MANY_REQUESTS",
      "Terlalu Banyak Permintaan",
      "Anda terlalu banyak melakukan permintaan, coba lagi setelah beberapa saat."
    ).toResponse();
  },

  handler: (req, res) => {
    const response = new WithoutDataResource(
      429,
      "TOO_MANY_REQUESTS",
      "Terlalu Banyak Permintaan",
      "Anda terlalu banyak melakukan permintaan, coba lagi setelah beberapa saat."
    );
    logger.warn(`| RateLimiter | Too many requests from IP: ${req.ip}`);
    res.status(429).json(response.toResponse());
  },
});

module.exports = limiter;
