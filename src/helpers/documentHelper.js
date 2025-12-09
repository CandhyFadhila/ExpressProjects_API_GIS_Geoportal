const fs = require("fs");
const path = require("path");
const knex = require("../config/database");
const logger = require("../utils/logger");

function formatFileSize(bytes) {
  const sizes = ["b", "kB", "mB", "gB", "tB"];
  if (bytes === 0) return "0 b";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

// Sanitasi nama file supaya aman dipakai di filesystem (terutama Windows)
function sanitizeBaseName(name) {
  if (!name) return "file";
  let cleaned = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return "file";
  return cleaned;
}

// Membuat nama file unik: "nama.ext", "nama (1).ext", "nama (2).ext", dst.
function getUniqueFileName(destinationDir, originalName) {
  const extension = path.extname(originalName || "");
  const rawBaseName = path.basename(originalName || "file", extension);
  const baseName = sanitizeBaseName(rawBaseName);

  let candidate = `${baseName}${extension}`;
  let counter = 1;

  while (fs.existsSync(path.join(destinationDir, candidate))) {
    candidate = `${baseName} (${counter})${extension}`;
    counter++;
  }

  return candidate;
}

async function uploadDocuments(files) {
  const uploadedResults = [];

  const destinationDir = path.join(
    __dirname,
    "..",
    "public",
    "storage",
    "documents"
  );

  try {
    if (!fs.existsSync(destinationDir)) {
      fs.mkdirSync(destinationDir, { recursive: true });
      logger.info(`| uploadDocuments | - Folder dibuat: ${destinationDir}`);
    }
  } catch (err) {
    logger.error(`| uploadDocuments | - Gagal membuat folder: ${err.message}`);
    throw new Error("Gagal menyiapkan direktori penyimpanan dokumen.");
  }

  for (const file of files) {
    try {
      const finalFileName = getUniqueFileName(
        destinationDir,
        file.originalname
      );

      const destinationPath = path.join(destinationDir, finalFileName);

      fs.renameSync(file.path, destinationPath); // move file

      const relativePath = `storage/documents/${finalFileName}`;
      const fileUrl = `${process.env.APP_URL}/${relativePath}`;
      const mimeType = file.mimetype;
      const fileSizeRaw = file.size;
      const fileSizeFormatted = formatFileSize(fileSizeRaw);

      const result = await knex("documents")
        .insert({
          file_name: finalFileName,
          file_path: relativePath,
          file_url: fileUrl,
          file_mime_type: mimeType,
          file_size: fileSizeRaw,
        })
        .returning(["id", "created_at", "updated_at", "deleted_at"]);

      const inserted = result[0];

      uploadedResults.push({
        id: inserted.id,
        file_name: finalFileName,
        file_path: relativePath,
        file_url: fileUrl,
        file_mime_type: mimeType,
        file_size: fileSizeFormatted,
        created_at: inserted.created_at,
        updated_at: inserted.updated_at,
        deleted_at: inserted.deleted_at,
      });

      logger.info(
        `| uploadDocuments | - File successfully uploaded: ${finalFileName} (${fileSizeFormatted})`
      );
    } catch (err) {
      logger.error(
        `| uploadDocuments | - Failed on file ${file.originalname}: ${err.message}`
      );
    }
  }

  return uploadedResults;
}

async function deleteDocuments(documentIds = []) {
  const deleted = [];

  for (const id of documentIds) {
    try {
      const document = await knex("documents")
        .select("file_path")
        .where({ id })
        .whereNull("deleted_at")
        .first();
      if (!document) {
        logger.warn(`| deleteDocuments | - Dokumen ID ${id} tidak ditemukan.`);
        continue;
      }

      const filePath = path.join(__dirname, "..", "public", document.file_path);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      } else {
        logger.warn(
          `| deleteDocuments | - File tidak ditemukan di path: ${filePath}`
        );
      }

      await knex("documents").where({ id }).del();

      deleted.push(id);
      logger.info(`| deleteDocuments | - Dokumen ${id} berhasil dihapus.`);
    } catch (error) {
      logger.error(
        `| deleteDocuments | - Gagal menghapus dokumen ${id}: ${error.message}`
      );
    }
  }

  return deleted;
}

module.exports = { uploadDocuments, deleteDocuments };
