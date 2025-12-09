// middlewares/cors.js
const cors = require("cors");

const corsOptions = {
  origin: "*", // Ganti jika ingin lebih aman misalnya: process.env.FRONTEND_URL
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

module.exports = cors(corsOptions);
