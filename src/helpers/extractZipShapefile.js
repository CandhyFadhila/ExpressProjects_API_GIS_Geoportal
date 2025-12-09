const AdmZip = require("adm-zip");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const logger = require("../utils/logger");

function getAllFilesRecursively(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      logger.info(
        `| getAllFilesRecursively | - Menelusuri folder: ${fullPath}`
      );
      getAllFilesRecursively(fullPath, arrayOfFiles);
    } else {
      logger.info(`| getAllFilesRecursively | - Menemukan file: ${fullPath}`);
      arrayOfFiles.push(fullPath);
    }
  });
  return arrayOfFiles;
}

async function extractZipShapefile(zipFilePath) {
  try {
    logger.info(`| extractZipShapefile | - Path ZIP masuk: ${zipFilePath}`);
    const isExist = fs.existsSync(zipFilePath);
    logger.info(`| extractZipShapefile | - Apakah ZIP ada di disk? ${isExist}`);

    if (!isExist) {
      throw new Error("File ZIP tidak ditemukan di path.");
    }

    // Buat folder tujuan ekstrak
    const folderName = uuidv4();
    const extractPath = path.join(
      __dirname,
      "..",
      "public",
      "storage",
      "temp",
      "shapefiles",
      folderName
    );

    logger.info(
      `| extractZipShapefile | - Folder tujuan ekstrak: ${extractPath}`
    );

    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
      logger.info(`| extractZipShapefile | - Folder baru dibuat.`);
    } else {
      logger.warn(`| extractZipShapefile | - Folder sudah ada sebelumnya.`);
    }

    // Ekstrak ZIP
    const zip = new AdmZip(zipFilePath);
    const zipEntries = zip.getEntries().map((entry) => entry.entryName);
    logger.info(
      `| extractZipShapefile | - Isi ZIP (entries): 
      ${JSON.stringify(zipEntries)}`
    );

    zip.extractAllTo(extractPath, true);
    logger.info(`| extractZipShapefile | - ZIP berhasil diekstrak.`);

    // Ambil semua file hasil ekstrak
    const fileList = getAllFilesRecursively(extractPath);
    logger.info(
      `| extractZipShapefile | - Jumlah file hasil ekstrak: ${fileList.length}`
    );
    logger.info(
      `| extractZipShapefile | - Daftar file: 
      ${JSON.stringify(fileList, null, 2)}`
    );

    return { extractPath, fileList };
  } catch (err) {
    logger.error(`| extractZipShapefile | - Gagal ekstrak: ${err.message}`);
    throw new Error("Gagal mengekstrak file shapefile ZIP.");
  }
}

module.exports = { extractZipShapefile };
