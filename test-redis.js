const redis = require("redis");

(async () => {
  // Buat Redis client
  const client = redis.createClient({
    socket: {
      host: "localhost", // Redis di WSL
      port: 6379,
    },
  });

  // Error handler
  client.on("error", (err) => console.error("Redis Client Error", err));

  // Tunggu koneksi selesai
  await client.connect();

  // Set data
  await client.set("test-key", "Hello Redis!");

  // Get data
  const reply = await client.get("test-key");
  console.log("Isi dari Redis:", reply);

  // Tutup koneksi
  await client.disconnect();
})();
