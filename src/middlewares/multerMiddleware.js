const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Tentukan folder tujuan
const uploadPath = path.join(__dirname, "..", "public", "storage", "documents");

// Pastikan folder sudah dibuat sebelum multer digunakan
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
  console.log(`[MULTER] Folder '${uploadPath}' telah dibuat.`);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const randomName = Math.random().toString(36).substring(2, 27);
    cb(null, randomName);
  },
});

const upload = multer({ storage });

module.exports = upload;
