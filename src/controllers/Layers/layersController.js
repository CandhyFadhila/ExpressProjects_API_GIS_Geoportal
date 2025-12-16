const { validationResult } = require("express-validator");
const knex = require("../../config/database");
const logger = require("../../utils/logger");
const {
  uploadDocuments,
  deleteDocuments,
} = require("../../helpers/documentHelper");
const WithDataResource = require("../../resources/WithDataResource");
const WithoutDataResource = require("../../resources/WithoutDataResource");
const fs = require("fs");
const path = require("path");
const { extractZipShapefile } = require("../../helpers/extractZipShapefile");
const {
  convertShapefileToPostgres,
} = require("../../helpers/convertShapefileToPostgres");
const workspaceResource = require("../../resources/Workspaces/workspaceResource");
const {
  convertShapefileRowsToGeoJSON,
} = require("../../helpers/shapefileToGeoJSONHelper");
const {
  resolveArrayRelations,
} = require("../../helpers/resolveArrayRelations");
const serializeLayer = require("../../resources/Layers/serializeLayer");
const { mapValuesToColor } = require("../../helpers/colorHelper");
const { isSuperAdminFromRequest } = require("../../helpers/roleHelper");
const { trimZeroDecimalsDeep } = require("../../helpers/numberTrim");

exports.store = async (req, res) => {
  const trx = await knex.transaction();
  const {
    workspace_id,
    parent_layer_id,
    name,
    description,
    is_boundary,
    table_name,
    file_type,
    layer_type,
    with_explanation,
  } = req.body;
  const layerType = String(layer_type ?? "")
    .trim()
    .toLowerCase();
  const isBoundary =
    typeof is_boundary === "boolean"
      ? is_boundary
      : ["true", "1", "yes", "y", "on"].includes(
          String(is_boundary ?? "")
            .trim()
            .toLowerCase()
        );

  try {
    const auth = await ensureWorkspaceOwner(req, workspace_id, trx);
    if (!auth.ok) {
      await trx.rollback();
      const response = new WithoutDataResource(
        auth.http,
        auth.code,
        auth.title,
        auth.desc
      );
      return res.status(auth.http).json(response.toResponse());
    }

    // 1. Validasi dengan express-validator
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors
        .array()
        .map((err) => err.msg)
        .join(" ");
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        message
      );
      await trx.rollback();
      return res.status(400).json(response.toResponse());
    }

    // 1.1 Validasi manual duplikat table_name
    const usedInLayers = await trx("layers")
      .where("table_name", table_name)
      .whereNull("deleted_at")
      .first();
    if (usedInLayers) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_LAYER_NAME",
        "Nama Tabel Telah Digunakan",
        "Nama tabel sudah digunakan oleh layer lain. Silakan gunakan nama lain."
      );
      return res.status(400).json(response.toResponse());
    }

    const resultTableNameExists = await trx.raw(
      `SELECT to_regclass(?) AS exists`,
      [table_name]
    );
    const existsInDb = resultTableNameExists.rows[0]?.exists !== null;
    if (existsInDb) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_LAYER_NAME",
        "Nama Tabel Sudah Ada di Database",
        "Nama tabel sudah ada di database. Silakan gunakan nama lain."
      );
      return res.status(400).json(response.toResponse());
    }

    // 1.2 Validasi manual untuk is_boundary
    if (isBoundary && layerType !== "symbol") {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "LAYER_TYPE_MUST_BE_SYMBOL",
        "Tipe Layer Tidak Valid untuk Boundary",
        "Ketika patok bernilai true, tipe layer harus 'symbol'."
      );
      return res.status(400).json(response.toResponse());
    }

    // 2. Validasi manual untuk files (req.files)
    if (!req.files || req.files.length === 0) {
      const response = new WithoutDataResource(
        400,
        "FILES_NOT_FOUND",
        "Dokumen Tidak Ditemukan",
        "Dokumen shapefile atau geojson wajib diunggah."
      );
      await trx.rollback();
      return res.status(400).json(response.toResponse());
    }
    if (req.files.length > 1) {
      const response = new WithoutDataResource(
        400,
        "MAX_FILES",
        "Terlalu Banyak Dokumen",
        "Maksimal hanya 1 file ZIP yang dapat diunggah."
      );
      await trx.rollback();
      return res.status(400).json(response.toResponse());
    }

    for (const file of req.files) {
      const allowedTypes = ["application/zip", "application/x-zip-compressed"];
      const isZipMime = allowedTypes.includes(file.mimetype);
      const isZipExtension =
        path.extname(file.originalname).toLowerCase() === ".zip";

      if (!isZipMime || !isZipExtension) {
        const response = new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          "Tipe Dokumen Salah",
          "File yang diunggah harus berformat .zip dan berisi shapefile."
        );
        await trx.rollback();
        return res.status(400).json(response.toResponse());
      }
      if (file.size > 50 * 1024 * 1024) {
        const response = new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          "Ukuran Dokumen Terlalu Besar",
          "Ukuran maksimal tiap file adalah 50MB."
        );
        await trx.rollback();
        return res.status(400).json(response.toResponse());
      }
    }

    // 3. Upload dokumen (document_id)
    const uploadedDocuments = await uploadDocuments(req.files);
    const document_id = uploadedDocuments[0]?.id;
    const relativePath = uploadedDocuments[0]?.file_path;
    const pathRoot = path.resolve(__dirname, "../../");
    const filePath = path.join(pathRoot, "public", relativePath);

    // 4. Simpan ke tabel layers
    const [newLayer] = await trx("layers")
      .insert({
        workspace_id,
        parent_layer_id: parent_layer_id || null,
        document_id,
        name,
        description,
        is_boundary: isBoundary,
        table_name,
        layer_type: layerType,
        with_explanation,
      })
      .returning("*");

    // 5. Jika tipe file 'shp', ekstrak dan unggah shapefile
    if (file_type === "shp") {
      // 5a. Ekstrak isi ZIP untuk validasi file shapefile
      const { extractPath, fileList } = await extractZipShapefile(filePath);

      // Ambil hanya file .shp, .shx, .dbf, .prj, .cpg dan abaikan folder / file lain
      const validExtensions = [".shp", ".shx", ".dbf", ".prj", ".cpg"];
      const shapefileComponents = fileList.filter((file) => {
        const ext = path.extname(file).toLowerCase();
        const base = path.basename(file);
        return (
          validExtensions.includes(ext) &&
          !file.includes("__MACOSX") &&
          !base.startsWith("._")
        );
      });

      const foundExtensions = shapefileComponents.map((file) =>
        path.extname(file).toLowerCase()
      );

      const hasSHP = foundExtensions.includes(".shp");
      const hasSHX = foundExtensions.includes(".shx");
      const hasDBF = foundExtensions.includes(".dbf");
      const hasPRJ = foundExtensions.includes(".prj");

      if (!(hasSHP && hasSHX && hasDBF)) {
        // Bersihkan folder temp jika tidak valid
        try {
          fs.rmSync(extractPath, { recursive: true, force: true });
        } catch (err) {
          logger.warn(
            `| Layers | - Gagal menghapus folder temp saat validasi gagal: ${err.message}`
          );
        }

        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "SHP_NOT_COMPLETE",
          "File Shapefile Tidak Lengkap",
          "File ZIP harus memuat file .shp, .shx, dan .dbf agar valid sebagai shapefile."
        );
        return res.status(400).json(response.toResponse());
      }

      // Baca preferensi CRS dari body
      // - source_srid bisa "EPSG:32749" atau hanya "32749"
      // - assume_4326 = true bila datanya memang sudah WGS84 (lon/lat)
      const srcSrsRaw = (req.body?.source_srid ?? "").toString().trim();
      const srcSrs = srcSrsRaw
        ? srcSrsRaw.toUpperCase().startsWith("EPSG:")
          ? srcSrsRaw.toUpperCase()
          : `EPSG:${srcSrsRaw}`
        : null;

      const assume4326 =
        String(req.body?.assume_4326).toLowerCase() === "true" ||
        req.body?.assume_4326 === true;

      if (!hasPRJ && !srcSrs && !assume4326) {
        try {
          fs.rmSync(extractPath, { recursive: true, force: true });
        } catch (err) {
          logger.warn(
            `| Layers | - Gagal menghapus folder temp (.prj tidak ada): ${err.message}`
          );
        }

        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "SRS_REQUIRED",
          "CRS Sumber Diperlukan",
          "File ZIP harus memuat file .prj. Sertakan file .prj terlebih dahulu agar dapat dilakukan konversi."
        );
        return res.status(400).json(response.toResponse());
      }

      // Ambil file .shp utama dari komponen valid
      const shpFile = shapefileComponents.find((file) => file.endsWith(".shp"));

      await handleShapefileUpload(
        shpFile,
        table_name,
        newLayer.id,
        with_explanation,
        layer_type
      );
    } // Catatan, jika tipe file 'geojson', buat fungsi baru lagi

    await trx.commit();

    const savedLayer = await knex("layers").where("id", newLayer.id).first();
    const result = await layersStoreUpdateWithoutGeojsonResource(savedLayer);

    const response = new WithDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Data layer '${name}' berhasil ditambahkan.`,
      result
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Layers | - Error function store: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.update = async (req, res) => {
  const trx = await knex.transaction();
  const {
    workspace_id,
    parent_layer_id,
    name,
    description,
    is_boundary,
    table_name,
    file_type,
    layer_type,
    with_explanation,
  } = req.body;
  const layerType = String(layer_type ?? "")
    .trim()
    .toLowerCase();
  const id = req.params.id;

  try {
    // 1. Validasi
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors
        .array()
        .map((err) => err.msg)
        .join(" ");
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        message
      );
      return res.status(400).json(response.toResponse());
    }

    // 2. Cek apakah data ada
    const existing = await trx("layers").where("id", id).first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    const hasLt = typeof layer_type !== "undefined";
    const hasBoundary = typeof is_boundary !== "undefined";

    const layerTypeEffective = hasLt
      ? layerType
      : String(existing.layer_type ?? "")
          .trim()
          .toLowerCase();

    const isBoundaryEffective = hasBoundary
      ? typeof is_boundary === "boolean"
        ? is_boundary
        : ["true", "1", "yes", "y", "on"].includes(
            String(is_boundary ?? "")
              .trim()
              .toLowerCase()
          )
      : Boolean(existing.is_boundary);

    // 🔒 2.1) Cross-field validation: boundary → wajib symbol
    if (isBoundaryEffective === true && layerTypeEffective !== "symbol") {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "LAYER_TYPE_MUST_BE_SYMBOL",
        "Tipe Layer Tidak Valid untuk Boundary",
        "Ketika patok bernilai true, tipe layer harus 'symbol'."
      );
      return res.status(400).json(response.toResponse());
    }

    // 3. Validasi duplikat hanya jika properties table_name berubah
    if (existing.table_name !== table_name) {
      const usedInLayers = await trx("layers")
        .where("table_name", table_name)
        .whereNull("deleted_at")
        .whereNot("id", id)
        .first();
      if (usedInLayers) {
        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "DUPLICATE_LAYER_NAME",
          "Nama Tabel Telah Digunakan",
          "Nama tabel sudah digunakan oleh layer lain. Silakan gunakan nama lain."
        );
        return res.status(400).json(response.toResponse());
      }

      const resultTableNameExists = await trx.raw(
        `SELECT to_regclass(?) AS exists`,
        [table_name]
      );
      const existsInDb = resultTableNameExists.rows[0]?.exists !== null;
      if (existsInDb) {
        await trx.rollback();
        const response = new WithoutDataResource(
          400,
          "DUPLICATE_LAYER_NAME",
          "Nama Tabel Sudah Ada di Database",
          "Nama tabel sudah ada di database. Silakan gunakan nama lain."
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // 3. Ambil dokumen sebelumnya
    const oldDocId = existing.document_id;
    let finalDocId = oldDocId;

    // 4. Upload dokumen baru
    let newDocId = null;
    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const allowedMime = ["application/zip", "application/x-zip-compressed"];
      const ext = path.extname(file.originalname).toLowerCase();

      if (!allowedMime.includes(file.mimetype) || ext !== ".zip") {
        const response = new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          "Tipe File Tidak Valid",
          "File yang diunggah harus berformat .zip dan berisi shapefile."
        );
        return res.status(400).json(response.toResponse());
      }
      if (file.size > 20 * 1024 * 1024) {
        const response = new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          "Ukuran File Terlalu Besar",
          "Ukuran maksimal file ZIP adalah 20MB."
        );
        return res.status(400).json(response.toResponse());
      }

      // 🔥 Hapus dokumen lama dan drop tabel lama
      if (oldDocId) {
        await handleDeleteTableWithDocument(existing.table_name, oldDocId);
        finalDocId = null;
      }

      const uploads = await uploadDocuments([file]);
      newDocId = uploads[0]?.id;

      // Ekstrak file ZIP ke tabel_name
      const relativePath = uploads[0]?.file_path;
      const pathRoot = path.resolve(__dirname, "../../");
      const filePath = path.join(pathRoot, "public", relativePath);

      if (file_type === "shp") {
        // 5a. Ekstrak isi ZIP untuk validasi file shapefile
        const { extractPath, fileList } = await extractZipShapefile(filePath);

        // Ambil hanya file .shp, .shx, .dbf, .prj, .cpg dan abaikan folder / file lain
        const validExtensions = [".shp", ".shx", ".dbf", ".prj", ".cpg"];
        const shapefileComponents = fileList.filter((file) => {
          const ext = path.extname(file).toLowerCase();
          const base = path.basename(file);
          return (
            validExtensions.includes(ext) &&
            !file.includes("__MACOSX") &&
            !base.startsWith("._")
          );
        });

        const foundExtensions = shapefileComponents.map((file) =>
          path.extname(file).toLowerCase()
        );

        const hasSHP = foundExtensions.includes(".shp");
        const hasSHX = foundExtensions.includes(".shx");
        const hasDBF = foundExtensions.includes(".dbf");
        const hasPRJ = foundExtensions.includes(".prj");

        if (!(hasSHP && hasSHX && hasDBF)) {
          try {
            fs.rmSync(extractPath, { recursive: true, force: true });
          } catch (err) {
            logger.warn(
              `| Layers | - Gagal menghapus folder temp saat validasi gagal: ${err.message}`
            );
          }

          await trx.rollback();
          const response = new WithoutDataResource(
            400,
            "SHP_NOT_COMPLETE",
            "File Shapefile Tidak Lengkap",
            "File ZIP harus memuat file .shp, .shx, dan .dbf agar valid sebagai shapefile."
          );
          return res.status(400).json(response.toResponse());
        }

        // Baca preferensi CRS dari body
        // - source_srid bisa "EPSG:32749" atau hanya "32749"
        // - assume_4326 = true bila datanya memang sudah WGS84 (lon/lat)
        const srcSrsRaw = (req.body?.source_srid ?? "").toString().trim();
        const srcSrs = srcSrsRaw
          ? srcSrsRaw.toUpperCase().startsWith("EPSG:")
            ? srcSrsRaw.toUpperCase()
            : `EPSG:${srcSrsRaw}`
          : null;

        const assume4326 =
          String(req.body?.assume_4326).toLowerCase() === "true" ||
          req.body?.assume_4326 === true;

        // Jika .prj tidak ada, wajib ada source_srid atau assume_4326
        if (!hasPRJ && !srcSrs && !assume4326) {
          try {
            fs.rmSync(extractPath, { recursive: true, force: true });
          } catch (err) {
            logger.warn(
              `| Layers | - Gagal menghapus folder temp (.prj tidak ada): ${err.message}`
            );
          }

          await trx.rollback();
          const response = new WithoutDataResource(
            400,
            "SRS_REQUIRED",
            "CRS Sumber Diperlukan",
            "ZIP Anda tidak memuat .prj. Sertakan file .prj, atau kirim 'source_srid' (mis. EPSG:32749) atau set 'assume_4326=true' bila datanya sudah WGS84."
          );
          return res.status(400).json(response.toResponse());
        }

        // Ambil file .shp utama dari komponen valid
        const shpFile = shapefileComponents.find((file) =>
          file.endsWith(".shp")
        );

        await handleShapefileUpload(
          shpFile,
          table_name,
          id,
          with_explanation,
          layer_type
        );
      } // Catatan, jika tipe file 'geojson', buat fungsi baru lagi
    }

    // 7. Finalisasi dokumen
    const document_id = newDocId || finalDocId;

    // 8. Rename tabel fisik jika nama table_name berubah (dan tidak mengganti file)
    const oldTableName = existing.table_name;
    if (oldTableName !== table_name && !(req.files && req.files.length > 0)) {
      const rawRenameQuery = `ALTER TABLE "${oldTableName}" RENAME TO "${table_name}"`;
      try {
        await trx.raw(rawRenameQuery);
        logger.info(
          `| Layers | - Tabel ${oldTableName} berhasil di-rename menjadi ${table_name}`
        );
      } catch (err) {
        await trx.rollback();
        logger.error(`| Layers | - Gagal rename tabel: ${err.message}`);
        const response = new WithoutDataResource(
          500,
          "SERVER_ERROR",
          "Server Sedang Error",
          "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
        );
        return res.status(500).json(response.toResponse());
      }
    }

    // 9. Update ke database
    await trx("layers")
      .where("id", id)
      .update({
        workspace_id,
        parent_layer_id: parent_layer_id || null,
        document_id,
        name,
        description,
        is_boundary: isBoundaryEffective,
        table_name,
        layer_type: layerTypeEffective,
        with_explanation,
        updated_at: trx.fn.now(),
      });

    // 10. Commit
    await trx.commit();

    const saved = await knex("layers").where("id", id).first();
    const result = await layersStoreUpdateWithoutGeojsonResource(saved);

    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_DATA",
      "Berhasil Memperbarui Data",
      `Data Layer '${name}' berhasil diperbarui.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Layers | - Error function update : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.destroy = async (req, res) => {
  const id = req.params.id;
  const trx = await knex.transaction();

  try {
    // 1. Ambil data layer
    const existing = await trx("layers").where("id", id).first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    const workspaceId = existing.workspace_id;
    const auth = await ensureWorkspaceOwner(req, workspaceId, trx);
    if (!auth.ok) {
      await trx.rollback();
      const response = new WithoutDataResource(
        auth.http,
        auth.code,
        auth.title,
        auth.desc
      );
      return res.status(auth.http).json(response.toResponse());
    }

    const { table_name, document_id } = existing;

    // 2. Jalankan helper untuk hapus tabel dan dokumen
    await handleDeleteTableWithDocument(table_name, document_id);

    // 3. Hapus layer dari DB
    await trx("layers").where("id", id).del();

    await trx.commit();

    const response = new WithoutDataResource(
      200,
      "SUCCESS_DELETE_DATA",
      "Berhasil Menghapus Data",
      `Layer dan seluruh data tabel shapefile atau geojson yang terkait berhasil dihapus.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Layers | - Error function destroy : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.getLayersbyWorkspaceId = async (req, res) => {
  const { workspace_id } = req.params;

  try {
    // 1. Ambil semua layer aktif berdasarkan workspace_id
    const layers = await knex("layers")
      .where("workspace_id", workspace_id)
      .whereNull("deleted_at");

    // Jika tidak ada layer sama sekali
    if (!layers || layers.length === 0) {
      const response = new WithoutDataResource(
        404,
        "LAYERS_NOT_FOUND",
        "Layer Tidak Ditemukan",
        `Tidak ada layer yang tersedia di workspace ID ${workspace_id}`
      );
      return res.status(404).json(response.toResponse());
    }

    // 2. Serialize setiap layer dengan layersResource
    const results = [];
    for (const layer of layers) {
      const serialized = await layersResource(layer);
      results.push(serialized);
    }

    // 3. Jika semua layer tidak memiliki shapefile (data kosong)
    if (results.every((layer) => layer.data.length === 0)) {
      const response = new WithoutDataResource(
        404,
        "SHAPEFILES_NOT_FOUND",
        "Shapefile Tidak Ditemukan",
        `Workspace ID ${workspace_id} memiliki layer, tetapi belum ada shapefile yang diunggah.`
      );
      return res.status(404).json(response.toResponse());
    }

    const response = new WithDataResource(
      200, // HTTP Status Code: Success
      "SUCCESS_GET_LAYERS",
      "Berhasil Mengambil Data Layer",
      `Berhasil mengambil semua layer untuk workspace ID ${workspace_id}`,
      results
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Layers | - Error getLayersbyWorkspaceId: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.getLayersbyWorkspaceIdWithoutGeojson = async (req, res) => {
  const { workspace_id } = req.params;

  try {
    // 1. Ambil semua layer aktif berdasarkan workspace_id
    const layers = await knex("layers")
      .where("workspace_id", workspace_id)
      .whereNull("deleted_at");

    // Jika tidak ada layer sama sekali
    if (!layers || layers.length === 0) {
      const response = new WithoutDataResource(
        404,
        "LAYERS_NOT_FOUND",
        "Layer Tidak Ditemukan",
        `Tidak ada layer yang tersedia di workspace ID ${workspace_id}`
      );
      return res.status(404).json(response.toResponse());
    }

    // 2. Serialize setiap layer dengan layersStoreUpdateWithoutGeojsonResource
    const results = [];
    for (const layer of layers) {
      const serialized = await layersStoreUpdateWithoutGeojsonResource(layer);
      results.push(serialized);
    }

    // 3. Jika semua layer tidak memiliki shapefile (data kosong)
    if (results.every((layer) => layer.data.length === 0)) {
      const response = new WithoutDataResource(
        404,
        "SHAPEFILES_NOT_FOUND",
        "Shapefile Tidak Ditemukan",
        `Workspace ID ${workspace_id} memiliki layer, tetapi belum ada shapefile yang diunggah.`
      );
      return res.status(404).json(response.toResponse());
    }

    const response = new WithDataResource(
      200, // HTTP Status Code: Success
      "SUCCESS_GET_LAYERS",
      "Berhasil Mengambil Data Layer",
      `Berhasil mengambil semua layer untuk workspace ID ${workspace_id}`,
      results
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Layers | - Error getLayersbyWorkspaceId: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.getLayerPropertiesbyLayerId = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Ambil layer berdasarkan layer_id
    const layer = await knex("layers")
      .select("id", "table_name")
      .where("id", id)
      .whereNull("deleted_at")
      .first();

    // 2. Jika layer tidak ditemukan
    if (!layer) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Ambil table_name & pecah schema bila ada
    const tableNameRaw = layer.table_name;
    let schema = "public";
    let tableName = tableNameRaw;

    if (tableNameRaw.includes(".")) {
      const [sch, tbl] = tableNameRaw.split(".", 2);
      schema = sch || "public";
      tableName = tbl;
    }

    // 4. Cek apakah tabel ada
    const existsQuery = await knex.raw(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) AS exists;
      `,
      [schema, tableName]
    );

    const tableExists = existsQuery.rows?.[0]?.exists === true;
    if (!tableExists) {
      const response = new WithoutDataResource(
        404,
        "TABLE_NOT_FOUND",
        "Tabel Tidak Ditemukan",
        `Tabel '${tableNameRaw}' tidak ditemukan pada schema '${schema}'.`
      );
      return res.status(404).json(response.toResponse());
    }

    // 5. Ambil semua kolom selain yang dikecualikan
    const columnsQuery = await knex.raw(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position;
      `,
      [schema, tableName]
    );

    const excluded = new Set([
      "id",
      "gid",
      "geom",
      "layer_id",
      "document_sk_ids",
      "other_document_ids",
      "image_ids",
      "color",
      "opacity",
    ]);
    const properties = (columnsQuery.rows || [])
      .map((r) => r.column_name)
      .filter((name) => !excluded.has(String(name).toLowerCase()));

    // 6. Susun result (tanpa resource transformer)
    const result = {
      table_name: tableNameRaw,
      properties, // array of string
    };

    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Berhasil mengambil daftar properti dari tabel '${tableNameRaw}'.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(
      `| Layers | - Error function getLayerPropertiesbyLayerId: ${error.message}`
    );
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.getLayerPropertiesValuebyLayerId = async (req, res) => {
  const { id } = req.params;
  const { property_key } = req.body;

  try {
    const keyRaw = String(property_key ?? "").trim();
    if (!keyRaw) {
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        "property_key wajib diisi."
      );
      return res.status(400).json(response.toResponse());
    }

    // 1. Ambil layer berdasarkan layer_id
    const layer = await knex("layers")
      .select("id", "table_name")
      .where("id", id)
      .whereNull("deleted_at")
      .first();

    // 2. Jika layer tidak ditemukan
    if (!layer) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Ambil table_name & pecah schema bila ada
    const tableNameRaw = layer.table_name;
    let schema = "public";
    let tableName = tableNameRaw;

    if (tableNameRaw.includes(".")) {
      const [sch, tbl] = tableNameRaw.split(".", 2);
      schema = sch || "public";
      tableName = tbl;
    }

    // 4. Cek apakah tabel ada
    const existsQuery = await knex.raw(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) AS exists;`,
      [schema, tableName]
    );

    const tableExists = existsQuery.rows?.[0]?.exists === true;
    if (!tableExists) {
      const response = new WithoutDataResource(
        404,
        "TABLE_NOT_FOUND",
        "Tabel Tidak Ditemukan",
        `Tabel '${tableNameRaw}' tidak ditemukan pada schema '${schema}'.`
      );
      return res.status(404).json(response.toResponse());
    }

    // 5. Ambil semua kolom selain yang dikecualikan
    const columnsQuery = await knex.raw(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      ORDER BY ordinal_position;
      `,
      [schema, tableName]
    );

    const excluded = new Set([
      "id",
      "gid",
      "geom",
      "layer_id",
      "document_sk_ids",
      "other_document_ids",
      "image_ids",
    ]);
    const allCols = (columnsQuery.rows || []).map((r) => r.column_name);
    const properties = allCols.filter(
      (name) => !excluded.has(String(name).toLowerCase())
    );

    const keyMatched = properties.includes(keyRaw) ? keyRaw : null;

    if (!keyMatched) {
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        `Kolom '${keyRaw}' tidak ditemukan pada tabel '${tableNameRaw}'.`
      );
      return res.status(400).json(response.toResponse());
    }

    const hasColor = allCols.some((c) => c.toLowerCase() === "color");
    if (!hasColor) {
      const response = new WithoutDataResource(
        400,
        "COLOR_COLUMN_NOT_AVAILABLE",
        "Format Data Tidak Sesuai Ketentuan",
        `Kolom 'color' tidak ditemukan pada tabel '${tableNameRaw}'.`
      );
      return res.status(400).json(response.toResponse());
    }

    const hasOpacity = allCols.some((c) => c.toLowerCase() === "opacity");
    if (!hasOpacity) {
      const response = new WithoutDataResource(
        400,
        "OPACITY_COLUMN_NOT_AVAILABLE",
        "Format Data Tidak Sesuai Ketentuan",
        `Kolom 'opacity' tidak ditemukan pada tabel '${tableNameRaw}'.`
      );
      return res.status(400).json(response.toResponse());
    }

    const rows = await knex
      .withSchema(schema)
      .from(tableName)
      .select(
        knex.raw('DISTINCT ON (??) ?? AS "value", "color", "opacity"', [
          keyMatched,
          keyMatched,
        ])
      )
      .whereNotNull(keyMatched)
      .andWhereRaw("btrim(CAST(?? AS TEXT)) <> ''", [keyMatched])
      .orderByRaw('?? ASC, (color IS NULL), "color" ASC', [keyMatched]);

    const values = rows.map((r) => ({
      value: r.value,
      color: r.color,
      opacity: r.opacity,
    }));

    const result = {
      table_name: tableNameRaw,
      property_key: keyMatched,
      values,
    };

    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Berhasil mengambil daftar properti_value dari tabel '${tableNameRaw}' dan properti_key '${property_key}'.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(
      `| Layers | - Error function getLayerPropertiesValuebyLayerId: ${error.message}`
    );
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.updateLayerFeatures = async (req, res) => {
  const {
    table_name,
    layer_id,
    properties,
    delete_sk_document_ids,
    delete_other_document_ids,
    delete_image_ids,
  } = req.body;
  const allowedUpdateColumns = [
    "PARAPIHAKB",
    "PERMASALAH",
    "TINDAKLANJ",
    "HASIL",
  ];

  const toArray = (val) => {
    if (val == null) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const parseDeleteIds = (val) => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed) ? parsed : "__INVALID__";
      } catch {
        return "__INVALID__";
      }
    }
    return "__INVALID__";
  };

  const validateFiles = (files, label) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    for (const f of files) {
      if (!allowed.includes(f.mimetype)) {
        throw new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          `Tipe Dokumen Salah (${label})`,
          "File dokumen hanya boleh PDF, DOC, dan DOCX."
        );
      }
      if (f.size > 10 * 1024 * 1024) {
        throw new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          `Ukuran Dokumen Terlalu Besar (${label})`,
          "Ukuran maksimal tiap file adalah 10MB."
        );
      }
    }
  };

  const validateImages = (files, label) => {
    const allowedImages = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];
    for (const f of files) {
      if (!allowedImages.includes(f.mimetype)) {
        throw new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          `Tipe Gambar Salah (${label})`,
          "File Gambar hanya boleh JPEG, JPG, PNG, dan WebP."
        );
      }
      if (f.size > 10 * 1024 * 1024) {
        throw new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          `Ukuran Gambar Terlalu Besar (${label})`,
          "Ukuran maksimal tiap file adalah 10MB."
        );
      }
    }
  };

  const uniq = (arr) => [...new Set(arr)];

  try {
    const trx = await knex.transaction();

    // 0. Validasi table_name ada di database
    const tableCheck = await trx.raw(`SELECT to_regclass(?) AS exists`, [
      table_name,
    ]);
    if (!tableCheck.rows[0]?.exists) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "TABLE_NOT_FOUND",
        "Tabel tidak ditemukan",
        `Tabel '${table_name}' tidak ditemukan di database.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 0. Validasi layer_id ada
    const layer = await trx("layers")
      .where("id", layer_id)
      .whereNull("deleted_at")
      .first();
    if (!layer) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "LAYER_NOT_FOUND",
        "Layer tidak ditemukan",
        `Layer dengan ID ${layer_id} tidak ditemukan.`
      );
      return res.status(400).json(response.toResponse());
    }

    const workspaceId = layer.workspace_id;
    const auth = await ensureWorkspaceOwner(req, workspaceId, trx);
    if (!auth.ok) {
      await trx.rollback();
      const response = new WithoutDataResource(
        auth.http,
        auth.code,
        auth.title,
        auth.desc
      );
      return res.status(auth.http).json(response.toResponse());
    }

    // 1. Parsing properti
    let parsedProperties = properties;
    if (typeof properties === "string") {
      parsedProperties = JSON.parse(properties);
    }

    // 2. Update data berdasarkan ID dalam properties
    const { id, ...updateFields } = parsedProperties;

    // 2.1 Validasi hanya kolom yang diizinkan
    const disallowedFields = Object.keys(updateFields).filter(
      (key) => !allowedUpdateColumns.includes(key)
    );
    if (disallowedFields.length > 0) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "UNAUTHORIZED_COLUMNS",
        "Terdapat kolom yang tidak diizinkan untuk diubah",
        `Hanya kolom berikut yang diperbolehkan untuk diubah: ${allowedUpdateColumns.join(
          ", "
        )}`
      );
      return res.status(400).json(response.toResponse());
    }

    // 2.2 Filter hanya kolom yang diizinkan untuk benar-benar diupdate
    const cleanedUpdateFields = Object.fromEntries(
      Object.entries(updateFields).filter(
        ([key, val]) => allowedUpdateColumns.includes(key) && val !== undefined
      )
    );

    let updated = 0;
    if (Object.keys(cleanedUpdateFields).length > 0) {
      // Hanya update jika ada kolom valid
      updated = await trx(table_name)
        .where("id", id)
        .update(cleanedUpdateFields);
      if (updated === 0) {
        await trx.rollback();
        const response = new WithoutDataResource(
          404,
          "DATA_NOT_FOUND",
          "Data tidak ditemukan",
          `Tidak ada baris dengan ID ${id} pada tabel ${table_name}.`
        );
        return res.status(404).json(response.toResponse());
      }
    } else {
      // Tidak ada kolom yang perlu diupdate (mis. hanya hapus/upload dokumen)
      const existsRow = await trx(table_name).where("id", id).first();
      if (!existsRow) {
        await trx.rollback();
        const response = new WithoutDataResource(
          404,
          "DATA_NOT_FOUND",
          "Data tidak ditemukan",
          `Tidak ada baris dengan ID ${id} pada tabel ${table_name}.`
        );
        return res.status(404).json(response.toResponse());
      }
    }

    // 3. Ambil document_ids yang sudah ada
    const existing = await trx(table_name).where("id", id).first();
    let currentSk = toArray(existing?.document_sk_ids);
    let currentOther = toArray(existing?.other_document_ids);
    let currentImage = toArray(existing?.image_ids);

    let delSkIds = parseDeleteIds(delete_sk_document_ids);
    if (delSkIds === "__INVALID__") {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "INVALID_DELETE_DOC_IDS",
        "Format delete_sk_document_ids tidak valid",
        "Pastikan delete_sk_document_ids berbentuk array JSON yang benar, contoh: [1,2,3]"
      );
      return res.status(400).json(response.toResponse());
    }
    let delOtherIds = parseDeleteIds(delete_other_document_ids);
    if (delOtherIds === "__INVALID__") {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "INVALID_DELETE_DOC_IDS",
        "Format delete_other_document_ids tidak valid",
        "Pastikan delete_other_document_ids berbentuk array JSON yang benar, contoh: [1,2,3]"
      );
      return res.status(400).json(response.toResponse());
    }
    let delImageIds = parseDeleteIds(delete_image_ids);
    if (delImageIds === "__INVALID__") {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "INVALID_DELETE_DOC_IDS",
        "Format delete_image_ids tidak valid",
        "Pastikan delete_image_ids berbentuk array JSON yang benar, contoh: [1,2,3]"
      );
      return res.status(400).json(response.toResponse());
    }

    if (
      delSkIds.length > 0 ||
      delOtherIds.length > 0 ||
      delImageIds.length > 0
    ) {
      const delSkSet = new Set(delSkIds);
      const delOtherSet = new Set(delOtherIds);
      const delImageSet = new Set(delImageIds);

      // simpan apa saja yang benar2 terhapus dari masing2 kolom
      const removedFromSk = currentSk.filter((x) => delSkSet.has(x));
      const removedFromOther = currentOther.filter((x) => delOtherSet.has(x));
      const removedFromImage = currentImage.filter((x) => delImageSet.has(x));

      // filter keluar dari masing-masing kolom
      currentSk = currentSk.filter((x) => !delSkSet.has(x));
      currentOther = currentOther.filter((x) => !delOtherSet.has(x));
      currentImage = currentImage.filter((x) => !delImageSet.has(x));

      // hitung file fisik yang aman untuk dihapus:
      // union(removed) MINUS (ID yang masih direferensikan di salah satu kolom setelah update)
      const unionRemoved = uniq([
        ...removedFromSk,
        ...removedFromOther,
        ...removedFromImage,
      ]);
      const stillReferenced = new Set([
        ...currentSk,
        ...currentOther,
        ...currentImage,
      ]);
      const toPhysicallyDelete = unionRemoved.filter(
        (x) => !stillReferenced.has(x)
      );

      if (toPhysicallyDelete.length > 0) {
        await deleteDocuments(toPhysicallyDelete);
      }

      await trx(table_name)
        .where("id", id)
        .update({
          document_sk_ids: JSON.stringify(currentSk),
          other_document_ids: JSON.stringify(currentOther),
          image_ids: JSON.stringify(currentImage),
        });
    }

    // 4. Proses penghapusan dokumen jika ada
    let skFiles = [];
    let otherFiles = [];
    let imageFiles = [];
    if (req.files && !Array.isArray(req.files)) {
      skFiles = Array.isArray(req.files.sk_document)
        ? req.files.sk_document
        : [];
      otherFiles = Array.isArray(req.files.other_document)
        ? req.files.other_document
        : [];
      imageFiles = Array.isArray(req.files.images) ? req.files.images : [];
    } else {
      skFiles = [];
      otherFiles = [];
      imageFiles = [];
    }

    // Validasi file
    validateFiles(skFiles, "sk_document");
    validateFiles(otherFiles, "other_document");
    validateImages(imageFiles, "images");

    // 5. Validasi & upload dokumen jika ada
    if (skFiles.length + currentSk.length > 5) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "MAX_TOTAL_FILES",
        "Terlalu Banyak Dokumen (sk_document)",
        `Dokumen sebelumnya berjumlah ${currentSk.length}, jika ditambah ${skFiles.length} akan melebihi batas maksimal 5 file.`
      );
      return res.status(400).json(response.toResponse());
    }
    if (otherFiles.length + currentOther.length > 5) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "MAX_TOTAL_FILES",
        "Terlalu Banyak Dokumen (other_document)",
        `Dokumen sebelumnya berjumlah ${currentOther.length}, jika ditambah ${otherFiles.length} akan melebihi batas maksimal 5 file.`
      );
      return res.status(400).json(response.toResponse());
    }
    if (imageFiles.length + currentImage.length > 5) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "MAX_TOTAL_FILES",
        "Terlalu Banyak Dokumen (images)",
        `Dokumen sebelumnya berjumlah ${currentImage.length}, jika ditambah ${imageFiles.length} akan melebihi batas maksimal 5 file.`
      );
      return res.status(400).json(response.toResponse());
    }

    // Proses upload
    if (skFiles.length > 0) {
      const uploadedSk = await uploadDocuments(skFiles);
      currentSk = uniq([...currentSk, ...uploadedSk.map((d) => d.id)]);
    }
    if (otherFiles.length > 0) {
      const uploadedOther = await uploadDocuments(otherFiles);
      currentOther = uniq([...currentOther, ...uploadedOther.map((d) => d.id)]);
    }
    if (imageFiles.length > 0) {
      const uploadedImage = await uploadDocuments(imageFiles);
      currentImage = uniq([...currentImage, ...uploadedImage.map((d) => d.id)]);
    }

    if (skFiles.length > 0 || otherFiles.length > 0 || imageFiles.length > 0) {
      await trx(table_name)
        .where("id", id)
        .update({
          document_sk_ids: JSON.stringify(currentSk),
          other_document_ids: JSON.stringify(currentOther),
          image_ids: JSON.stringify(currentImage),
        });
    }

    // 6. Commit transaksi
    await trx.commit();

    // 7. Ambil kembali layer terbaru
    const updatedLayer = await knex("layers").where("id", layer_id).first();
    const result = await layersSingleFeatureWithoutGeojsonResource(
      updatedLayer,
      0,
      id
    );

    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_SHAPEFILE",
      "Data berhasil diperbarui",
      `Data shapefile dengan ID ${id} pada tabel ${table_name} berhasil diperbarui.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();

    if (error && typeof error.toResponse === "function") {
      try {
        const resp = error.toResponse();
        return res.status(resp?.http || 400).json(resp);
      } catch {
        logger.warn(`| Update Shapefile | - Known error (raw)`);
        return res.status(error.http || 400).json(error.toResponse());
      }
    }

    // Unknown error
    const msg =
      (error && (error.stack || error.message)) ||
      (typeof error === "string" ? error : JSON.stringify(error));

    logger.error(`| Update Shapefile | - Error updateLayerFeatures: ${msg}`);

    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );

    res.status(500).json(response.toResponse());
  }
};

exports.updateLayerColor = async (req, res) => {
  const { id } = req.params;
  const { property_key, colorscale } = req.body;

  try {
    // 1. Parsing colorscale jika dalam bentuk string
    if (typeof colorscale === "string") {
      try {
        colorscale = JSON.parse(colorscale); // Parsing string JSON menjadi array
      } catch (error) {
        const response = new WithoutDataResource(
          400,
          "FORMAT_INVALID",
          "Format colorscale Tidak Valid",
          `Colorscale harus dalam format array string JSON.`
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // Pastikan colorscale adalah array
    if (!Array.isArray(colorscale)) {
      const response = new WithoutDataResource(
        400,
        "INVALID_COLORSCALE",
        "Colorscale Tidak Valid",
        `Colorscale harus berupa array.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 2. Ambil layer berdasarkan layer_id
    const layer = await knex("layers")
      .select("id", "workspace_id", "table_name")
      .where("id", id)
      .whereNull("deleted_at")
      .first();
    if (!layer) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    const trx = await knex.transaction();
    try {
      const auth = await ensureWorkspaceOwner(req, layer.workspace_id, trx);
      if (!auth.ok) {
        await trx.rollback();
        const response = new WithoutDataResource(
          auth.http,
          auth.code,
          auth.title,
          auth.desc
        );
        return res.status(auth.http).json(response.toResponse());
      }

      const tableNameRaw = layer.table_name;
      let schema = "public";
      let tableName = tableNameRaw;

      if (tableNameRaw.includes(".")) {
        const [sch, tbl] = tableNameRaw.split(".", 2);
        schema = sch || "public";
        tableName = tbl;
      }

      // 3. Cek apakah tabel ada
      const existsQuery = await knex.raw(
        `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) AS exists;
      `,
        [schema, tableName]
      );
      const tableExists = existsQuery.rows?.[0]?.exists === true;
      if (!tableExists) {
        const response = new WithoutDataResource(
          404,
          "TABLE_NOT_FOUND",
          "Tabel Tidak Ditemukan",
          `Tabel '${tableNameRaw}' tidak ditemukan pada schema '${schema}'.`
        );
        return res.status(404).json(response.toResponse());
      }

      // 4. Cek kolom color sudah ready apa belum
      const colorColCheck = await knex.raw(
        `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = 'color'
      LIMIT 1
      `,
        [schema, tableName]
      );
      if (colorColCheck.rows.length === 0) {
        const response = new WithoutDataResource(
          400,
          "COLOR_COLUMN_NOT_AVAILABLE",
          "Kolom color tidak tersedia",
          "Kolom color tidak tersedia, lakukan upload ulang SHP atau buat baru."
        );
        return res.status(400).json(response.toResponse());
      }

      // 5. Cek apakah kolom property_key ada dalam tabel
      const columnCheck = await knex.raw(
        `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ? AND column_name = ?
      `,
        [schema, tableName, property_key]
      );
      if (columnCheck.rows.length === 0) {
        const response = new WithoutDataResource(
          400,
          "COLUMN_NOT_FOUND",
          "Kolom Tidak Ditemukan",
          `Kolom '${property_key}' tidak ditemukan di tabel '${tableName}'.`
        );
        return res.status(400).json(response.toResponse());
      }

      // 6. Ambil nilai unik dari kolom property_key (hindari duplikat)
      const valuesQuery = await knex(schema)
        .select(property_key)
        .distinct()
        .from(tableName)
        .whereNotNull(property_key);

      const values = valuesQuery.map((row) => row[property_key]);

      // 7. Buat mapping nilai ke warna
      const valueToColor = mapValuesToColor(values, colorscale);

      // 8. Update color dan color_property_key
      const updates = [];
      for (const value of values) {
        const color = valueToColor.get(value);

        // Jika warna lama ada, set null dulu
        updates.push(
          knex(tableName)
            .where(property_key, value)
            .update({ color: null })
            .then(() => {
              return knex(tableName)
                .where(property_key, value)
                .update({ color });
            })
        );
      }

      // 9. Simpan property_key ke dalam color_property_key di tabel 'layers'
      await knex("layers")
        .where("id", id)
        .update({ color_property_key: property_key });

      // Menjalankan semua query update sekaligus
      await Promise.all(updates);
      const response = new WithoutDataResource(
        200,
        "SUCCESS_UPDATE_DATA",
        "Berhasil Memperbarui Data",
        `Warna untuk properti '${property_key}' pada tabel '${tableName}' berhasil diperbarui.`
      );
      return res.status(200).json(response.toResponse());
    } catch (error) {
      try {
        await trx.rollback();
      } catch (_) {}
      throw error;
    }
  } catch (error) {
    logger.error(
      `| Layers | - Error function updateLayerColor: ${error.message}`
    );
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.updateLayerColorbyPropertyKey = async (req, res) => {
  const { id } = req.params;
  const { property_key, property_values } = req.body;

  try {
    const keyRaw = String(property_key ?? "").trim();
    if (!keyRaw) {
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        "property_key wajib diisi."
      );
      return res.status(400).json(response.toResponse());
    }

    if (!Array.isArray(property_values) || property_values.length === 0) {
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        "property_values harus berupa array berisi minimal satu item."
      );
      return res.status(400).json(response.toResponse());
    }

    const pairsMap = new Map();
    for (const item of property_values) {
      const pv = item?.property_value;
      const col = String(item?.color ?? "").trim();
      let opacity = String(item?.opacity ?? "").trim();
      if (pv === undefined || pv === null) continue;
      if (col.length === 0) continue; // abaikan jika color kosong
      // Jika opacity kosong atau tidak ada, biarkan kosong dan jangan update
      if (opacity === undefined || opacity === null || opacity === "") {
        opacity = null;
      }

      pairsMap.set(pv, { color: col, opacity });
    }
    const pairs = Array.from(
      pairsMap,
      ([property_value, { color, opacity }]) => ({
        property_value,
        color,
        opacity,
      })
    );
    if (pairs.length === 0) {
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        "Semua item property_values tidak valid (property_value/color/opacity kosong)."
      );
      return res.status(400).json(response.toResponse());
    }

    // 1. Ambil layer
    const layer = await knex("layers")
      .select("id", "workspace_id", "table_name")
      .where("id", id)
      .whereNull("deleted_at")
      .first();
    if (!layer) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Layer dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    const trx = await knex.transaction();
    try {
      const auth = await ensureWorkspaceOwner(req, layer.workspace_id, trx);
      if (!auth.ok) {
        await trx.rollback();
        const response = new WithoutDataResource(
          auth.http,
          auth.code,
          auth.title,
          auth.desc
        );
        return res.status(auth.http).json(response.toResponse());
      }

      const tableNameRaw = layer.table_name;
      let schema = "public";
      let tableName = tableNameRaw;

      if (tableNameRaw.includes(".")) {
        const [sch, tbl] = tableNameRaw.split(".", 2);
        schema = sch || "public";
        tableName = tbl;
      }

      // 3. Cek apakah tabel ada
      const existsQuery = await knex.raw(
        `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) AS exists;
      `,
        [schema, tableName]
      );
      const tableExists = existsQuery.rows?.[0]?.exists === true;
      if (!tableExists) {
        const response = new WithoutDataResource(
          404,
          "TABLE_NOT_FOUND",
          "Tabel Tidak Ditemukan",
          `Tabel '${tableNameRaw}' tidak ditemukan pada schema '${schema}'.`
        );
        return res.status(404).json(response.toResponse());
      }

      // 4. Cek kolom color & kolom property_key
      const columnsQuery = await knex.raw(
        `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?
      `,
        [schema, tableName]
      );
      const allCols = (columnsQuery.rows || []).map((r) => r.column_name);
      if (!allCols.includes("color")) {
        const response = new WithoutDataResource(
          400,
          "COLOR_COLUMN_NOT_AVAILABLE",
          "Kolom color tidak tersedia",
          "Kolom color tidak tersedia, lakukan upload ulang SHP atau buat baru."
        );
        return res.status(400).json(response.toResponse());
      }
      if (!allCols.includes("opacity")) {
        const response = new WithoutDataResource(
          400,
          "OPACITY_COLUMN_NOT_AVAILABLE",
          "Kolom opacity tidak tersedia",
          "Kolom opacity tidak tersedia, lakukan upload ulang SHP atau buat baru."
        );
        return res.status(400).json(response.toResponse());
      }
      if (!allCols.includes(keyRaw)) {
        const response = new WithoutDataResource(
          400,
          "COLUMN_NOT_FOUND",
          "Kolom Tidak Ditemukan",
          `Kolom '${keyRaw}' tidak ditemukan di tabel '${tableNameRaw}'.`
        );
        return res.status(400).json(response.toResponse());
      }

      await knex.transaction(async (trx) => {
        for (const { property_value, color, opacity } of pairs) {
          // Hanya update opacity jika ada dan tidak kosong
          const updateData = { color };
          if (opacity !== null) {
            updateData.opacity = opacity;
          }
          await trx(tableName)
            .withSchema(schema)
            .where(keyRaw, property_value)
            .update(updateData);
        }

        await trx("layers")
          .where("id", id)
          .update({ color_property_key: keyRaw });
      });

      const response = new WithoutDataResource(
        200,
        "SUCCESS_UPDATE_DATA",
        "Berhasil Memperbarui Data",
        `Warna untuk properti '${property_key}' pada tabel '${tableName}' berhasil diperbarui.`
      );
      return res.status(200).json(response.toResponse());
    } catch (error) {
      try {
        await trx.rollback();
      } catch (_) {}
      throw error;
    }
  } catch (error) {
    logger.error(
      `| Layers | - Error function updateLayerColorbyPropertyKey: ${error.message}`
    );
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

// Fungsi untuk menampilkan dengan geojson
async function layersResource(layer, depth = 0) {
  const MAX_DEPTH = 3;
  const workspace = layer.workspace_id
    ? await knex("workspaces").where("id", layer.workspace_id).first()
    : null;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  const serializedLayer = await serializeLayer(layer);

  // Ambil semua baris dari table_name
  let data = null;
  try {
    const rows = await knex(layer.table_name).select("*");

    if (rows.length > 0) {
      const firstRow = rows[0];

      const geojsonResult = convertShapefileRowsToGeoJSON(rows);
      const features = geojsonResult.features;
      const bbox = geojsonResult.bbox;
      const center = geojsonResult.center;

      // Memasukkan dokumen ke dalam setiap fitur geojson berdasarkan document_ids tiap2 fitur
      for (const feature of features) {
        feature.properties = trimZeroDecimalsDeep(feature.properties, {
          returnType: "string",
          maxFractionDigits: 12,
          onlyIfHasDecimalPoint: true,
        });

        const SkDocs = feature.properties.document_sk_ids || [];
        const OtherDocs = feature.properties.other_document_ids || [];
        const ImageDocs = feature.properties.image_ids || [];
        const sk_document = await resolveArrayRelations(SkDocs, "documents");
        const other_document = await resolveArrayRelations(
          OtherDocs,
          "documents"
        );
        const image = await resolveArrayRelations(ImageDocs, "documents");

        // Masukkan dokumen ke dalam features tapi diluar properties
        feature.sk_document = sk_document;
        feature.other_document = other_document;
        feature.images = image;
      }

      data = {
        id: firstRow.id,
        layer_id: serializedLayer,
        bbox,
        bbox_center: center,
        geojson: {
          type: "FeatureCollection",
          features,
        },
        created_at: firstRow.created_at,
        updated_at: firstRow.updated_at,
        deleted_at: firstRow.deleted_at,
      };
    }
  } catch (err) {
    console.error(
      `❌ Error mengambil data dari ${layer.table_name}:`,
      err.message
    );
    data = null;
  }

  return {
    id: layer.id,
    workspace: workspace ? await workspaceResource(workspace) : null,
    parent_layer_id: parentLayer
      ? await layersResource(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    table_name: layer.table_name,
    is_boundary: layer.is_boundary,
    layer_type: layer.layer_type,
    with_explanation: layer.with_explanation,
    color_property_key: layer.color_property_key,
    data,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

// Fungsi untuk menampilkan tanpa geojson
async function layersStoreUpdateWithoutGeojsonResource(layer, depth = 0) {
  const MAX_DEPTH = 3;
  const workspace = layer.workspace_id
    ? await knex("workspaces").where("id", layer.workspace_id).first()
    : null;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  const serializedLayer = await serializeLayer(layer);

  // Ambil semua baris dari table_name
  let data = null;
  try {
    const rows = await knex(layer.table_name).select("*");

    if (rows.length > 0) {
      const firstRow = rows[0];

      const geojsonResult = convertShapefileRowsToGeoJSON(rows);
      // const features = geojsonResult.features;
      const bbox = geojsonResult.bbox;
      const center = geojsonResult.center;

      // const documents = await resolveArrayRelations(
      //   firstRow.document_ids || [],
      //   "documents"
      // );

      data = {
        id: firstRow.id,
        layer_id: serializedLayer,
        // documents,
        bbox,
        bbox_center: center,
        // geojson: {
        //   type: "FeatureCollection",
        //   features,
        // },
        created_at: firstRow.created_at,
        updated_at: firstRow.updated_at,
        deleted_at: firstRow.deleted_at,
      };
    }
  } catch (err) {
    console.error(
      `❌ Error mengambil data dari ${layer.table_name}:`,
      err.message
    );
    data = null;
  }

  return {
    id: layer.id,
    workspace: workspace ? await workspaceResource(workspace) : null,
    parent_layer_id: parentLayer
      ? await layersResource(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    is_boundary: layer.is_boundary,
    table_name: layer.table_name,
    layer_type: layer.layer_type,
    with_explanation: layer.with_explanation,
    color_property_key: layer.color_property_key,
    data,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

// Fungsi untuk menampilkan tanpa geojson tapi hanya 1 bidang
async function layersSingleFeatureWithoutGeojsonResource(
  layer,
  depth = 0,
  featureId
) {
  const MAX_DEPTH = 3;
  const workspace = layer.workspace_id
    ? await knex("workspaces").where("id", layer.workspace_id).first()
    : null;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  const serializedLayer = await serializeLayer(layer);

  // Ambil semua baris dari table_name
  let data = null;
  try {
    const rows = await knex(layer.table_name)
      .where("id", featureId)
      .select("*")
      .limit(1);

    if (rows.length > 0) {
      const firstRow = rows[0];

      const geojsonResult = convertShapefileRowsToGeoJSON(rows);
      const features = geojsonResult.features;
      const bbox = geojsonResult.bbox;
      const center = geojsonResult.center;

      // Memasukkan dokumen ke dalam setiap fitur geojson berdasarkan document_ids tiap2 fitur
      for (const feature of features) {
        const SkDocs = feature.properties.document_sk_ids || [];
        const OtherDocs = feature.properties.other_document_ids || [];
        const ImageDocs = feature.properties.image_ids || [];
        const sk_document = await resolveArrayRelations(SkDocs, "documents");
        const other_document = await resolveArrayRelations(
          OtherDocs,
          "documents"
        );
        const image = await resolveArrayRelations(ImageDocs, "documents");

        // Masukkan dokumen ke dalam features tapi diluar properties
        feature.sk_document = sk_document;
        feature.other_document = other_document;
        feature.images = image;

        delete feature.geometry;
      }

      const feature = features[0];

      data = {
        id: firstRow.id,
        layer_id: serializedLayer,
        bbox,
        bbox_center: center,
        geojson: {
          type: "FeatureCollection",
          features: [feature],
        },
        created_at: firstRow.created_at,
        updated_at: firstRow.updated_at,
        deleted_at: firstRow.deleted_at,
      };
    }
  } catch (err) {
    console.error(
      `❌ Error mengambil data dari ${layer.table_name}:`,
      err.message
    );
    data = null;
  }

  return {
    id: layer.id,
    workspace: workspace ? await workspaceResource(workspace) : null,
    parent_layer_id: parentLayer
      ? await layersResource(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    is_boundary: layer.is_boundary,
    table_name: layer.table_name,
    layer_type: layer.layer_type,
    with_explanation: layer.with_explanation,
    color_property_key: layer.color_property_key,
    data,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

// Fungsi untuk upload shapefile
async function handleShapefileUpload(
  shpFullPath,
  tableName,
  layerId,
  withExplanation = false,
  layerType
) {
  await convertShapefileToPostgres(
    shpFullPath,
    tableName,
    "public",
    layerId,
    withExplanation,
    layerType
  );

  // Setelah konversi selesai, hapus folder temp
  try {
    const extractPath = path.dirname(shpFullPath);
    fs.rmSync(extractPath, { recursive: true, force: true });
    logger.info(
      `| handleShapefileUpload | - Folder temp ${extractPath} berhasil dihapus.`
    );
  } catch (err) {
    logger.error(
      `| handleShapefileUpload | - Gagal menghapus folder temp: ${err.message}`
    );
  }
}

// Fungsi untuk delete table dan documents terkait
async function handleDeleteTableWithDocument(tableName, layerDocumentId) {
  try {
    // 1. Cek apakah kolom "document_ids" ada di dalam table
    const cols = await knex("information_schema.columns")
      .select("column_name")
      .where({ table_name: tableName })
      .whereIn("column_name", ["document_sk_ids", "other_document_ids"]);

    const hasSk = cols.some((c) => c.column_name === "document_sk_ids");
    const hasOther = cols.some((c) => c.column_name === "other_document_ids");

    let collectedDocIds = [];

    const toArray = (val) => {
      if (val == null) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === "object") {
        return Array.isArray(val) ? val : [];
      }
      if (typeof val === "string") {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };

    // 2) Ambil semua nilai kolom yang ada & kumpulkan ID unik
    if (hasSk || hasOther) {
      const selectCols = [];
      if (hasSk) selectCols.push("document_sk_ids");
      if (hasOther) selectCols.push("other_document_ids");

      const records = await knex.select(selectCols).from(tableName);

      const set = new Set();
      for (const row of records) {
        if (hasSk) {
          for (const v of toArray(row.document_sk_ids)) set.add(v);
        }
        if (hasOther) {
          for (const v of toArray(row.other_document_ids)) set.add(v);
        }
      }
      collectedDocIds = Array.from(set);
      if (collectedDocIds.length > 0) {
        await deleteDocuments(collectedDocIds);
      }
    }

    // 3) Hapus dokumen utama layer (jika ada) & belum termasuk
    if (layerDocumentId && !collectedDocIds.includes(layerDocumentId)) {
      await deleteDocuments([layerDocumentId]);
    }

    // 4. Drop table fisik dari PostgreSQL
    await knex.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
  } catch (error) {
    throw new Error(
      `Gagal menghapus dokumen dan tabel '${tableName}': ${error.message}`
    );
  }
}

async function ensureWorkspaceOwner(req, workspaceId, trxOrKnex = knex) {
  const userId = req.userId;
  if (!userId) {
    return {
      ok: false,
      http: 401,
      code: "UNAUTHORIZED",
      title: "Tidak Terautentikasi",
      desc: "Silakan login terlebih dahulu.",
    };
  }

  try {
    const isSuperAdmin = await isSuperAdminFromRequest(req);
    if (isSuperAdmin) {
      return { ok: true, who: "super_admin" };
    }

    const workspace = await trxOrKnex("workspaces")
      .select("id", "created_by")
      .where({ id: workspaceId })
      .first();

    if (!workspace) {
      return {
        ok: false,
        http: 200,
        code: "DATA_NOT_FOUND",
        title: "Data Tidak Ditemukan",
        desc: `Workspace dengan ID '${workspaceId}' tidak ditemukan.`,
      };
    }

    if (
      workspace.created_by != null &&
      Number(workspace.created_by) === Number(userId)
    ) {
      return { ok: true, who: "owner", workspace };
    }

    return {
      ok: false,
      http: 403,
      code: "NO_ACCESS",
      title: "Akses Ditolak",
      desc: "Hanya pembuat workspace yang dapat mengelola layer saat ini.",
    };
  } catch (err) {
    logger.error(`| Auth | - Error ensureWorkspaceOwner: ${err.message}`);
    return {
      ok: false,
      http: 500,
      code: "SERVER_ERROR",
      title: "Server Sedang Error",
      desc: "Terjadi kesalahan pada sistem saat memeriksa akses.",
    };
  }
}
