const { validationResult } = require("express-validator");
const knex = require("../../config/database");
const logger = require("../../utils/logger");
const {
  applySearch,
  applyPagination,
  formatPaginationResult,
} = require("../../helpers/queryHelper");
const {
  uploadDocuments,
  deleteDocuments,
} = require("../../helpers/documentHelper");
const WithDataResource = require("../../resources/WithDataResource");
const WithoutDataResource = require("../../resources/WithoutDataResource");
const { isSuperAdminFromRequest } = require("../../helpers/roleHelper");
const workspaceResource = require("../../resources/Workspaces/workspaceResource");

exports.index = async (req, res) => {
  try {
    const { search } = req.query;

    // 1. Bangun query dasar
    let query = knex("workspaces as w")
      .select(
        "w.id",
        "w.created_by",
        "w.category_id",
        "w.title",
        "w.description",
        "w.document_id",
        "w.deleted_at",
        "w.created_at",
        "w.updated_at"
      )
      .leftJoin("workspace_categories as c", "w.category_id", "c.id")
      .whereNull("w.deleted_at")
      .orderBy("w.created_at", "desc");

    // 2. Tambahkan search jika ada
    applySearch(query, search, ["w.title", "c.label"]);

    // 3. Tambahkan pagination
    const paginationInfo = applyPagination(query, req.query);

    // 4. Jalankan query & hitung total
    const result = await formatPaginationResult(query, paginationInfo, knex);

    // 5. Handle jika data kosong
    if (result.data.length === 0) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        "Tidak ada data yang sesuai dengan filter atau pencarian."
      );
      return res.status(200).json(response.toResponse());
    }

    // 6. Map data melalui WorkspaceResource
    const serializedData = await Promise.all(
      result.data.map((workspace) => workspaceResource(workspace))
    );

    // 7. Kirim respons sukses
    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      "Data workspaces berhasil diambil.",
      {
        data: serializedData,
        pagination: result.pagination,
      }
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function index : ${error.message}`);
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
  const trx = await knex.transaction();
  const { workspace_category_id, title, description } = req.body;
  const userId = req.userId;

  try {
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
      return res.status(400).json(response.toResponse());
    }

    // 2. Validasi manual untuk files (req.files)
    // if (!req.files || req.files.length === 0) {
    //   const response = new WithoutDataResource(
    //     400,
    //     "FILES_NOT_FOUND",
    //     "Dokumen Tidak Ditemukan",
    //     "Dokumen thumbnail wajib diunggah."
    //   );
    //   return res.status(400).json(response.toResponse());
    // }
    if (req.files.length > 1) {
      const response = new WithoutDataResource(
        400,
        "MAX_FILES",
        "Terlalu Banyak Dokumen",
        "Maksimal upload adalah 1 file."
      );
      return res.status(400).json(response.toResponse());
    }

    for (const file of req.files) {
      const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];
      if (!allowedTypes.includes(file.mimetype)) {
        const response = new WithoutDataResource(
          400,
          "INVALID_FILE_TYPE",
          "Tipe Dokumen Salah",
          "File dokumen hanya boleh JPG, JPEG, atau PNG."
        );
        return res.status(400).json(response.toResponse());
      }
      if (file.size > 10 * 1024 * 1024) {
        const response = new WithoutDataResource(
          400,
          "FILE_TOO_LARGE",
          "Ukuran Dokumen Terlalu Besar",
          "Ukuran maksimal tiap file adalah 10MB."
        );
        return res.status(400).json(response.toResponse());
      }
    }

    // 3. Cek duplikat title
    const exists = await trx("workspaces")
      .where("title", title)
      .whereNull("deleted_at")
      .first();
    if (exists) {
      const response = new WithoutDataResource(
        400,
        "DUPLICATE_TITLE",
        "Duplikat Data",
        `Judul workspace '${title}' sudah digunakan. Silakan gunakan judul lain.`
      );
      return res.status(400).json(response.toResponse());
    }

    // 4. Upload dokumen (document_id)
    const uploadedDocuments = await uploadDocuments(req.files);
    const document_id =
      uploadedDocuments.length > 0 ? uploadedDocuments[0].id : null;

    // 5. Simpan workspace
    const [newWorkspace] = await trx("workspaces")
      .insert({
        created_by: userId,
        category_id: workspace_category_id,
        document_id,
        title,
        description,
      })
      .returning("*");

    await trx.commit();

    const savedWorkspace = await knex("workspaces")
      .where("id", newWorkspace.id)
      .first();
    const result = await workspaceResource(savedWorkspace);

    const response = new WithDataResource(
      201,
      "SUCCESS_CREATE_DATA",
      "Berhasil Menyimpan Data",
      `Data workspace '${title}' berhasil ditambahkan.`,
      result
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Workspace | - Error function store: ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem, silahkan coba lagi nanti atau hubungi admin."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.show = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Ambil data workspace + relasi ke documents & workspace_categories
    const workspace = await knex("workspaces")
      .select("*")
      .where("id", id)
      .first();

    // 2. Jika tidak ditemukan
    if (!workspace) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Format resource
    const data = await workspaceResource(workspace);
    const response = new WithDataResource(
      200,
      "SUCCESS_GET_DATA",
      "Berhasil Mengambil Data",
      `Detail data workspace '${workspace.title}' berhasil didapatkan.`,
      data
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| Workspace | - Error function show: ${error.message}`);
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
  const { title, description, workspace_category_id, delete_document_ids } =
    req.body;
  const id = req.params.id;

  try {
    const auth = await ensureWorkspaceOwner(req, id, trx);
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
    const existing = await trx("workspaces").where("id", id).first();
    if (!existing) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Data workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 3. Cek duplikat title (selain ID sekarang)
    const duplicate = await trx("workspaces")
      .where("title", title)
      .whereNull("deleted_at")
      .whereNot("id", id)
      .first();
    if (duplicate) {
      const response = new WithoutDataResource(
        200,
        "DUPLICATE_TITLE",
        "Duplikat Data",
        `Judul '${title}' sudah digunakan pada workspace lain.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 4. Ambil dokumen sebelumnya
    const oldDocId = existing.document_id;
    const deletedIds = delete_document_ids || [];

    // 5. Jika ingin hapus dokumen lama
    let finalDocId = oldDocId;
    if (deletedIds.includes(String(oldDocId))) {
      await deleteDocuments([oldDocId]);
      finalDocId = null;
    }

    // 6. Upload dokumen baru
    let newDocId = null;
    if (req.files && req.files.length > 0) {
      const uploads = await uploadDocuments(req.files);
      newDocId = uploads[0]?.id;
    }

    // 7. Finalisasi dokumen thumbnail
    const document_id = newDocId || finalDocId;

    // 8. Update ke database
    await trx("workspaces").where("id", id).update({
      title,
      description,
      category_id: workspace_category_id,
      document_id,
      updated_at: trx.fn.now(),
    });

    // 9. Commit
    await trx.commit();

    const savedWorkspace = await knex("workspaces").where("id", id).first();
    const result = await workspaceResource(savedWorkspace);

    const response = new WithDataResource(
      200,
      "SUCCESS_UPDATE_DATA",
      "Berhasil Memperbarui",
      `Data workspace '${title}' berhasil diperbarui.`,
      result
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Workspace | - Error function update : ${error.message}`);
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

  // helper: parse array jsonb/text/null -> array
  const toArray = (val) => {
    if (val == null) return [];
    if (Array.isArray(val)) return val;
    if (typeof val === "object") return Array.isArray(val) ? val : [];
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

  // helper: cek tabel ada
  const tableExists = async (t, txx) => {
    const r = await txx.raw(`SELECT to_regclass(?) AS exists`, [t]);
    return Boolean(r?.rows?.[0]?.exists);
  };

  // helper: cek kolom ada
  const getDocCols = async (t, txx) => {
    const rows = await txx("information_schema.columns")
      .select("column_name")
      .where({ table_name: t })
      .whereIn("column_name", ["document_sk_ids", "other_document_ids"]);
    const hasSk = rows.some((r) => r.column_name === "document_sk_ids");
    const hasOther = rows.some((r) => r.column_name === "other_document_ids");
    return { hasSk, hasOther };
  };

  try {
    const auth = await ensureWorkspaceOwner(req, id, trx);
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

    // 1. Cari data workspace
    const workspace = await trx("workspaces").where("id", id).first();
    if (!workspace) {
      const response = new WithoutDataResource(
        200,
        "DATA_NOT_FOUND",
        "Data Tidak Ditemukan",
        `Workspace dengan ID '${id}' tidak ditemukan.`
      );
      return res.status(200).json(response.toResponse());
    }

    // 2. Ambil semua layers milik workspace
    const layers = await trx("layers")
      .where("workspace_id", id)
      .whereNull("deleted_at");

    const tableNames = layers.map((l) => l.table_name);
    const layerDocumentIds = layers.map((l) => l.document_id).filter(Boolean);

    // 3) kumpulkan semua dokumen tertanam dari setiap tabel dinamis (dua kolom baru)
    const embeddedSet = new Set();
    for (const tableName of tableNames) {
      // skip kalau tabelnya memang sudah tidak ada
      const exists = await tableExists(tableName, trx);
      if (!exists) {
        logger.warn(
          `| Workspace | - Tabel '${tableName}' tidak ditemukan, skip koleksi dokumen.`
        );
        continue;
      }

      const { hasSk, hasOther } = await getDocCols(tableName, trx);
      if (!hasSk && !hasOther) {
        // nggak ada kolom dokumen di tabel ini
        continue;
      }

      const selectCols = [];
      if (hasSk) selectCols.push("document_sk_ids");
      if (hasOther) selectCols.push("other_document_ids");

      const rows = await trx.select(selectCols).from(tableName);
      for (const row of rows) {
        if (hasSk)
          for (const v of toArray(row.document_sk_ids)) embeddedSet.add(v);
        if (hasOther)
          for (const v of toArray(row.other_document_ids)) embeddedSet.add(v);
      }
    }

    // 4) siapkan daftar final untuk deleteDocuments (tambahkan dokumen layer & workspace)
    if (workspace.document_id) embeddedSet.add(workspace.document_id);
    for (const lid of layerDocumentIds) embeddedSet.add(lid);

    const toDelete = Array.from(embeddedSet).filter(Boolean);

    // 5) HAPUS isi tabel dinamis (atau bisa DROP kalau kebijakanmu)
    for (const tableName of tableNames) {
      const exists = await tableExists(tableName, trx);
      if (!exists) {
        logger.warn(
          `| Workspace | - Tabel '${tableName}' tidak ditemukan saat delete isi, skip.`
        );
        continue;
      }
      await trx.raw(`DROP TABLE IF EXISTS "${tableName}" CASCADE`);
    }

    // 6. Delete layers
    await trx("layers").where("workspace_id", id).del();

    // 7. Delete workspace
    await trx("workspaces").where("id", id).del();

    // 8) commit dulu agar relasi sudah putus
    await trx.commit();

    // 9) baru hapus file fisik + row 'documents'
    if (toDelete.length > 0) {
      try {
        const deletedIds = await deleteDocuments(toDelete);
        if (deletedIds.length !== toDelete.length) {
          logger.warn(
            `| Workspace | - Tidak semua dokumen terhapus. Req=${toDelete.length}, OK=${deletedIds.length}`
          );
        }
      } catch (e) {
        logger.error(`| Workspace | - Gagal deleteDocuments: ${e.message}`);
      }
    }

    const response = new WithoutDataResource(
      200,
      "SUCCESS_DELETE_DATA",
      "Berhasil Menghapus Data",
      `Workspace dan seluruh data yang terkait berhasil dihapus.`
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    await trx.rollback();
    logger.error(`| Workspace | - Error function destroy : ${error.message}`);
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Server Sedang Error",
      "Terjadi kesalahan pada sistem. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};

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
