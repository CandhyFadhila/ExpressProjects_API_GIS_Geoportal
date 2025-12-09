const redis = require("redis");

// Setup Redis client
const client = redis.createClient({
  socket: {
    host: "localhost",
    port: 6379,
  },
});

// Connect to Redis secara eksplisit
(async () => {
  try {
    await client.connect();
    console.log("✅ Redis client connected successfully.");
  } catch (error) {
    console.error("❌ Redis connection error:", error);
  }
})();

// Handle Redis error event
client.on("error", (err) => {
  console.error("Redis Error:", err);
});

module.exports = client;
