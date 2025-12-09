const { body } = require("express-validator");
const knex = require("../../config/database");

exports.updateWorkspaceValidator = [
  body("title")
    .notEmpty()
    .withMessage("Judul workspace tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Judul workspace harus berupa teks.")
    .bail()
    .isLength({ max: 255 })
    .withMessage("Judul workspace maksimal 255 karakter.")
    .bail()
    .custom(async (value, { req }) => {
      const id = req.params.id;
      const exists = await knex("workspaces")
        .where("title", value)
        .whereNot("id", id)
        .whereNull("deleted_at")
        .first();
      if (exists) {
        throw new Error("Judul workspace sudah digunakan oleh workspace lain.");
      }

      return true;
    }),

  body("description")
    .notEmpty()
    .withMessage("Deskripsi workspace tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Deskripsi workspace harus berupa teks."),

  body("workspace_category_id")
    .optional()
    .isInt()
    .withMessage("Kategori workspace harus berupa angka.")
    .bail()
    .custom(async (value) => {
      const category = await knex("workspace_categories")
        .where("id", value)
        .first();
      if (!category) {
        throw new Error("Kategori workspace tidak ditemukan.");
      }
      return true;
    }),

  body("delete_document_ids.*")
    .optional()
    .isNumeric()
    .withMessage("Setiap ID dokumen yang dihapus harus berupa angka."),
];
