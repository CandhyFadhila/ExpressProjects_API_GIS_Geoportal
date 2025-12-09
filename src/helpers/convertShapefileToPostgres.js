const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { getPgClientByEnv } = require("../helpers/pgClient");
const { getOgrConfigByEnv } = require("../helpers/ogrHelper");
const logger = require("../utils/logger");

async function convertShapefileToPostgres(
  shpFilePath,
  tableName,
  schemaName = "public",
  layerId = null,
  withExplanation = false,
  layerType
) {
  // Gunakan path lengkap ke ogr2ogr.exe
  const { ogrCmd, env } = getOgrConfigByEnv(
    shpFilePath,
    tableName,
    schemaName,
    layerType
  );
  logger.info(`| convertShapefile | Eksekusi perintah: ${ogrCmd}`);

  try {
    // 1. Eksekusi perintah ogr2ogr
    const { stdout, stderr } = await execAsync(ogrCmd, {
      env,
      maxBuffer: 1024 * 1024 * 20,
      timeout: 300000,
      windowsHide: true,
    });

    if (stderr) logger.warn(`| convertShapefile | STDERR: ${stderr}`);
    if (stdout) logger.info(`| convertShapefile | STDOUT: ${stdout}`);

    // 2. Tunggu hingga tabel benar-benar tersedia
    const clientCheck = await getPgClientByEnv();
    try {
      let retries = 10;
      let tableExists = false;

      while (retries > 0) {
        const result = await clientCheck.query(
          `SELECT to_regclass('"${schemaName}"."${tableName}"') AS exists`
        );

        if (result.rows[0].exists) {
          tableExists = true;
          break;
        }

        retries--;
        logger.info(
          `| convertShapefile | Menunggu tabel "${tableName}" tersedia... (${
            10 - retries
          }/10)`
        );
        await new Promise((res) => setTimeout(res, 500)); // delay 0.5 detik
      }

      if (!tableExists) {
        throw new Error(
          `Tabel "${schemaName}"."${tableName}" tidak ditemukan setelah import.`
        );
      }
    } finally {
      await clientCheck.end();
    }

    await normalizePrimaryKey(schemaName, tableName);

    await alterTableForMeta(schemaName, tableName);

    if (withExplanation) {
      await addExplanationColumnsIfNeeded(schemaName, tableName); //Required | Optional
    }

    // 4. Perbaiki panjang kolom jika perlu
    // await checkAndFixCharacterVaryingLength(schemaName, tableName); //Optional

    // 5. Isi layer_id jika ada
    if (layerId) {
      const client = await getPgClientByEnv();
      try {
        await client.query(
          `UPDATE "${schemaName}"."${tableName}" SET layer_id = $1`,
          [layerId]
        );
        logger.info(
          `| convertShapefile | Semua baris di tabel ${schemaName}.${tableName} berhasil diisi layer_id = ${layerId}`
        );
      } catch (err) {
        logger.warn(
          `| convertShapefile | Gagal mengisi layer_id: ${err.message}`
        );
      } finally {
        await client.end();
      }
    }

    return `Berhasil impor shapefile dan modifikasi kolom di tabel ${schemaName}.${tableName}`;
  } catch (err) {
    logger.error(`| convertShapefile | Gagal: ${err.message}`);
    throw new Error("Gagal memproses shapefile ke PostgreSQL");
  }
}

// Tambah kolom layer_id dan document_ids
async function alterTableForMeta(schemaName, tableName) {
  const client = await getPgClientByEnv();

  try {
    // 1. Tambahkan kolom layer_id jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS layer_id BIGINT;
    `);

    // 2. Tambahkan kolom document_sk_ids jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS document_sk_ids JSONB DEFAULT '[]';
    `);

    // 3. Tambahkan kolom other_document_ids jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS other_document_ids JSONB DEFAULT '[]';
    `);

    // 4. Tambahkan kolom image_ids jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS image_ids JSONB DEFAULT '[]';
    `);

    // 5. Tambahkan kolom color jika belum ada
    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS color VARCHAR(9);
    `);

    await client.query(`
      ALTER TABLE "${schemaName}"."${tableName}"
      ADD COLUMN IF NOT EXISTS opacity VARCHAR DEFAULT '0.8';
    `);

    logger.info(
      `| alterTableForMeta | Kolom layer_id, document_sk_ids, other_document_ids, image_ids, color, dan opacity berhasil ditambahkan pada ${schemaName}.${tableName}`
    );
  } catch (err) {
    throw new Error(
      `Gagal menambahkan kolom/constraint ke tabel: ${err.message}`
    );
  } finally {
    await client.end();
  }
}

async function addExplanationColumnsIfNeeded(schemaName, tableName) {
  const client = await getPgClientByEnv();
  const columnsToCheck = ["PARAPIHAKB", "PERMASALAH", "TINDAKLANJ", "HASIL"];

  try {
    const res = await client.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
    `,
      [schemaName, tableName]
    );

    const existingColumns = res.rows.map((row) => row.column_name);

    const columnsToAdd = columnsToCheck.filter(
      (col) => !existingColumns.includes(col)
    );

    for (const col of columnsToAdd) {
      try {
        await client.query(`
          ALTER TABLE "${schemaName}"."${tableName}"
          ADD COLUMN "${col}" TEXT;
        `);
        logger.info(
          `| addExplanationColumnsIfNeeded | Kolom ${col} berhasil ditambahkan ke ${schemaName}.${tableName}`
        );
      } catch (colErr) {
        logger.warn(
          `| addExplanationColumnsIfNeeded | Gagal menambahkan kolom ${col} ke ${schemaName}.${tableName}: ${colErr.message}`
        );
      }
    }

    // Jika tidak ada kolom yang ditambahkan
    if (columnsToAdd.length === 0) {
      logger.info(
        `| addExplanationColumnsIfNeeded | Semua kolom sudah ada di ${schemaName}.${tableName}, tidak ada yang ditambahkan.`
      );
    }
  } catch (err) {
    logger.error(
      `| addExplanationColumnsIfNeeded | Error utama: ${err.message}`
    );
    throw new Error(
      `Gagal memproses pengecekan dan penambahan kolom penjelasan`
    );
  } finally {
    await client.end();
  }
}

async function normalizePrimaryKey(schemaName, tableName) {
  const client = await getPgClientByEnv();
  try {
    const qCols = `
      SELECT column_name, is_identity
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2
        AND column_name IN ('ogc_fid','id')
      ORDER BY column_name;
    `;
    const { rows } = await client.query(qCols, [schemaName, tableName]);
    const hasOgc = rows.some((r) => r.column_name === "ogc_fid");
    const hasId = rows.some((r) => r.column_name === "id");

    if (hasOgc && !hasId) {
      await client.query(
        `ALTER TABLE "${schemaName}"."${tableName}" RENAME COLUMN ogc_fid TO id;`
      );
    }

    // Pastikan kolom 'id' adalah identity/auto-increment
    const qId = `
      SELECT is_identity
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 AND column_name='id'
      LIMIT 1;
    `;
    const rId = await client.query(qId, [schemaName, tableName]);
    const isIdentity = rId.rows[0]?.is_identity === "YES";

    if (!isIdentity) {
      try {
        await client.query(
          `ALTER TABLE "${schemaName}"."${tableName}"
            ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;`
        );
      } catch (e) {
        // If fails (mis. sudah ada DEFAULT), diamkan saja
      }
    }
  } finally {
    await client.end();
  }
}

// Update kolom shp jadi lowercase
// async function checkAndFixCharacterVaryingLength(schemaName, tableName) {
//   const client = await getPgClientByEnv();

//   try {
//     const query = `
//       SELECT column_name, character_maximum_length
//       FROM information_schema.columns
//       WHERE table_schema = $1
//       AND table_name = $2
//       AND data_type = 'character varying';
//     `;
//     const res = await client.query(query, [schemaName, tableName]);

//     // Jika ada kolom character varying dengan panjang < 254, lakukan perubahan
//     const columnsToUpdate = res.rows.filter(
//       (row) => row.character_maximum_length < 254
//     );

//     if (columnsToUpdate.length > 0) {
//       logger.info(
//         `| convertShapefile | Kolom dengan panjang kurang dari 254 ditemukan: ${columnsToUpdate
//           .map((row) => row.column_name)
//           .join(", ")}`
//       );
//       for (const column of columnsToUpdate) {
//         const alterQuery = `
//           ALTER TABLE "${schemaName}"."${tableName}"
//           ALTER COLUMN "${column.column_name}" SET DATA TYPE character varying(254);
//         `;
//         await client.query(alterQuery);
//         logger.info(
//           `| convertShapefile | Panjang kolom ${column.column_name} diubah menjadi 254`
//         );
//       }
//     } else {
//       logger.info(
//         `| convertShapefile | Semua kolom sudah memiliki panjang >= 254`
//       );
//     }
//   } catch (err) {
//     throw new Error(
//       `Error saat memeriksa dan memperbaiki panjang kolom: ${err.message}`
//     );
//   } finally {
//     await client.end();
//   }
// }

module.exports = { convertShapefileToPostgres };
