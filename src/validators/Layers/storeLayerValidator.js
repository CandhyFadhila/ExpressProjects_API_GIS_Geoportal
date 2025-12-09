const { body } = require("express-validator");
const knex = require("../../config/database");

exports.storeLayerValidator = [
  body("workspace_id")
    .notEmpty()
    .withMessage("Workspace wajib dipilih.")
    .bail()
    .isInt()
    .withMessage("Workspace harus berupa angka.")
    .bail()
    .custom(async (value) => {
      const workspace = await knex("workspaces").where("id", value).first();
      if (!workspace) {
        throw new Error("Workspace yang Anda pilih tidak ditemukan.");
      }
      return true;
    }),

  body("parent_layer_id")
    .customSanitizer((v) => {
      if (v === undefined || v === null) return undefined;
      const s = String(v).trim().toLowerCase();
      if (s === "" || s === "undefined" || s === "null") return undefined;
      return s;
    })
    .optional({ nullable: true })
    .isInt()
    .withMessage("Parent Layer harus berupa angka.")
    .bail()
    .custom(async (value) => {
      if (value !== null) {
        const layer = await knex("layers").where("id", value).first();
        if (!layer) {
          throw new Error("Parent Layer tidak ditemukan.");
        }
      }
      return true;
    }),

  body("name")
    .notEmpty()
    .withMessage("Nama layer tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Nama layer harus berupa teks.")
    .isLength({ max: 255 })
    .withMessage("Nama layer maksimal 255 karakter."),

  body("description")
    .optional()
    .isString()
    .withMessage("Deskripsi harus berupa teks."),

  body("file_type")
    .notEmpty()
    .withMessage("Tipe file tidak boleh kosong.")
    .isIn(["shp", "geojson"])
    .withMessage("File yang dapat diunggah hanya shapefile atau GeoJSON."),

  body("layer_type")
    .notEmpty()
    .withMessage("Tipe layer tidak boleh kosong.")
    .isIn(["fill", "line", "symbol"])
    .withMessage(
      "Tipe layer yang boleh digunakan hanya Fill, Line, atau Symbol."
    ),

  body("with_explanation")
    .optional()
    .bail()
    .customSanitizer((value) => {
      return String(value).toLowerCase() === "true";
    })
    .isBoolean()
    .withMessage("With explanation harus bernilai boolean (true atau false)."),

  body("is_boundary")
    .optional()
    .bail()
    .customSanitizer((value) => {
      return String(value).toLowerCase() === "true";
    })
    .isBoolean()
    .withMessage("Patok harus bernilai boolean (true atau false)."),

  body("table_name")
    .notEmpty()
    .withMessage("Nama tabel tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Nama tabel harus berupa teks.")
    .isLength({ max: 255 })
    .withMessage("Nama tabel maksimal 255 karakter.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Nama tabel hanya boleh mengandung huruf, angka, dan underscore."
    ),
];
