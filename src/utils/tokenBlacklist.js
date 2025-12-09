const redisClient = require("../config/redisClient");

// Tambahkan token ke blacklist
const blacklistToken = async (token, expirationInSeconds) => {
  const exp = parseInt(expirationInSeconds, 10);

  if (!Number.isInteger(exp) || exp <= 0) {
    // Fallback default 1 hari
    console.warn(
      `[Redis] Invalid expirationInSeconds (${expirationInSeconds}), fallback to 86400`
    );
    await redisClient.setEx(`blacklist:${token}`, 86400, "true");
  } else {
    await redisClient.setEx(`blacklist:${token}`, exp, "true");
  }
};

// Cek apakah token ada di blacklist
const isTokenBlacklisted = async (token) => {
  const result = await redisClient.get(`blacklist:${token}`);
  return result === "true";
};

module.exports = {
  blacklistToken,
  isTokenBlacklisted,
};
