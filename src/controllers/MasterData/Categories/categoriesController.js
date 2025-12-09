const { validationResult } = require("express-validator");
const knex = require("../../../config/database");
const logger = require("../../../utils/logger");
const {
  applySearch,
  applyPagination,
  formatPaginationResult,
} = require("../../../helpers/queryHelper");
const WithDataResource = require("../../../resources/WithDataResource");
const WithoutDataResource = require("../../../resources/WithoutDataResource");
const categoriesResource = require("../../../resources/Categories/categoriesResource");
const { isSuperAdminFromRequest } = require("../../../helpers/roleHelper");

exports.index = async (req, res) => {
  try {
    const { search, with_trashed } = req.query;

    // 1. Bangun query dasar
    let query = knex("workspace_categories as c")
      .select("c.id", "c.label", "c.deleted_at", "c.created_at", "c.updated_at")
      .orderBy("c.created_at", "desc");

    // 2. Filter hanya data yang belum dihapus jika with_trashed != 1
    if (with_trashed !== "1") {
      query.whereNull("c.deleted_at");
    }

    // 3. Tambahkan search jika ada
    applySearch(query, search, ["c.label"]);

    // 4. Tambahkan pagination
    const paginationInfo = applyPagination(query, req.query);

    // 5. Jalankan query & hitung total
    const result = await formatPaginationResult(query, paginationInfo, knex);

    // 6. Handle jika data kosong
    if (result.data.length === 0) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        "Tidak ada data yang sesuai dengan filter atau pencarian."
      );
      return res.status(200).json(response.toResponse());
    }

    // 7. Map data melalui categoriesResource
    const serializedData = await Promise.all(
      result.data.map((categories) => categoriesResource(categories))
    );

    // 8. Kirim respons sukses
    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      "Data kategori berhasil diambil.",
      {
        data: serializedData,
        pagination: result.pagination,
      }
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Categories | - Error function index : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silakan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.store = async (req, res) => {
  const isSuperAdmin = await isSuperAdminFromRequest(req);
  if (!isSuperAdmin) {
    const response = new WithoutDataResource(
      403,
      "NO_ACCESS",
      "Akses ditolak",
      "Maaf anda tidak memiliki akses untuk melakukan proses ini."
    );
    logger.info(
      `| Categories | - Akses ditolak (bukan super admin), userId=${req.userId}`
    );
    return res.status(403).json(response.toResponse());
  }

  const trx = await knex.transaction();
  const { label } = req.body;

  try {
    // 1. Validasi input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const message = errors
        .array()
        .map((err) => err.msg)
        .join(" ");
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "FAILED_VALIDATION",
        "Format Data Tidak Sesuai Ketentuan",
        message
      );
      return res.status(400).json(response.toResponse());
    }

    // 2. Cek duplikat label
    const exists = await trx("workspace_categories")
      .where("label", label)
      .whereNull("deleted_at")
      .first();

    if (exists) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_NAME",
        "Duplikat Data",
        `Penamaan kategori '${label}' sudah digunakan. Silakan gunakan penamaan lain.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 3. Simpan kategori baru
    const [newCategory] = await trx("workspace_categories")
      .insert({ label })
      .returning("*");

    await trx.commit();

    // 4. Format resource
    const formatted = await categoriesResource(newCategory);

    // 5. Kirim response berhasil
    const response = new WithDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Data kategori '${label}' berhasil ditambahkan.`,
      formatted
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Categories | - Error function store: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silakan coba lagi nanti atau hubungi admin."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.show = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Cari data kategori berdasarkan ID (termasuk yang sudah soft-deleted)
    const category = await knex("workspace_categories").where("id", id).first();

    // 2. Jika tidak ditemukan
    if (!category) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data kategori dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Format resource dan kirim response sukses
    const formatted = await categoriesResource(category);
    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Detail data kategori '${category.label}' berhasil didapatkan.`,
      formatted
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Categories | - Error function show: ${error.message}`);
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
  const isSuperAdmin = await isSuperAdminFromRequest(req);
  if (!isSuperAdmin) {
    const response = new WithoutDataResource(
      403,
      "NO_ACCESS",
      "Akses ditolak",
      "Maaf anda tidak memiliki akses untuk melakukan proses ini."
    );
    logger.info(
      `| Categories | - Akses ditolak (bukan super admin), userId=${req.userId}`
    );
    return res.status(403).json(response.toResponse());
  }

  const trx = await knex.transaction();

  try {
    // 1. Validasi input
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

    const { label } = req.body;
    const { id } = req.params;

    // 2. Cek apakah data ada
    const existing = await trx("workspace_categories").where("id", id).first();
    if (!existing) {
      await trx.rollback();
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data kategori dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Cek duplikat label selain ID sekarang
    const duplicate = await trx("workspace_categories")
      .where("label", label)
      .whereNull("deleted_at")
      .whereNot("id", id)
      .first();

    if (duplicate) {
      await trx.rollback();
      const response = new WithoutDataResource(
        200,
        "DUPLICATE_NAME",
        "Duplikat Data",
        `Nama kategori '${label}' sudah digunakan pada data lain.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 4. Lakukan update
    const [updated] = await trx("workspace_categories")
      .where("id", id)
      .update({
        label,
        updated_at: trx.fn.now(),
      })
      .returning("*");

    await trx.commit();

    // 5. Format dan response sukses
    const formatted = await categoriesResource(updated);
    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_DATA",
      "Berhasil Memperbarui",
      `Data kategori '${label}' berhasil diperbarui.`,
      formatted
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Categories | - Error function update: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.destroy = async (req, res) => {
  const isSuperAdmin = await isSuperAdminFromRequest(req);
  if (!isSuperAdmin) {
    const response = new WithoutDataResource(
      403,
      "NO_ACCESS",
      "Akses ditolak",
      "Maaf anda tidak memiliki akses untuk melakukan proses ini."
    );
    logger.info(
      `| Categories | - Akses ditolak (bukan super admin), userId=${req.userId}`
    );
    return res.status(403).json(response.toResponse());
  }

  const id = req.params.id;
  const trx = await knex.transaction();

  try {
    // 1. Cek apakah data kategori ada
    const existing = await trx("workspace_categories").where("id", id).first();
    if (!existing) {
      await trx.rollback();
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Kategori dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 2. Lakukan soft delete (update deleted_at)
    await trx("workspace_categories").where("id", id).update({
      deleted_at: trx.fn.now(),
    });

    await trx.commit();

    // 3. Kirim response sukses
    const response = new WithoutDataResource(
      200,
      "SUCCESS_DELETE_DATA",
      "Berhasil Menghapus Data",
      `Data kategori '${existing.label}' berhasil dihapus (soft delete).`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Categories | - Error function destroy : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

exports.restore = async (req, res) => {
  const isSuperAdmin = await isSuperAdminFromRequest(req);
  if (!isSuperAdmin) {
    const response = new WithoutDataResource(
      403,
      "NO_ACCESS",
      "Akses ditolak",
      "Maaf anda tidak memiliki akses untuk melakukan proses ini."
    );
    logger.info(
      `| Categories | - Akses ditolak (bukan super admin), userId=${req.userId}`
    );
    return res.status(403).json(response.toResponse());
  }

  const { id } = req.params;
  const trx = await knex.transaction();

  try {
    // 1. Cari data kategori yang sudah soft-deleted
    const deletedCategory = await trx("workspace_categories")
      .where("id", id)
      .whereNotNull("deleted_at")
      .first();

    if (!deletedCategory) {
      await trx.rollback();
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Kategori dengan ID '${id}' tidak ditemukan atau belum dihapus.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 2. Cek apakah ada kategori aktif lain dengan nama yang sama
    const isDuplicate = await trx("workspace_categories")
      .where("label", deletedCategory.label)
      .whereNull("deleted_at")
      .first();

    if (isDuplicate) {
      await trx.rollback();
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_NAME",
        "Duplikat Data",
        `Nama kategori '${deletedCategory.label}' sudah digunakan oleh entri aktif lain. Silakan ubah nama terlebih dahulu sebelum merestore.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 3. Restore: update deleted_at ke null
    await trx("workspace_categories").where("id", id).update({
      deleted_at: null,
      updated_at: trx.fn.now(),
    });

    await trx.commit();

    const response = new WithoutDataResource(
      200,
      "SUCCESS_RESTORE_DATA",
      "Berhasil Mengembalikan Data",
      `Data kategori '${deletedCategory.label}' berhasil dikembalikan.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Categories | - Error function restore: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};
