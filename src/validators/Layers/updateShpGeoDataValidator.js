const { body } = require("express-validator");

exports.updateShpGeoDataValidator = [
  body("table_name")
    .notEmpty()
    .withMessage("Nama tabel tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Nama tabel harus berupa teks.")
    .bail()
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Nama tabel hanya boleh mengandung huruf, angka, dan underscore."
    ),

  body("layer_id")
    .notEmpty()
    .withMessage("Layer wajib dipilih.")
    .bail()
    .isInt()
    .withMessage("Layer harus berupa angka."),

  body("properties")
    .notEmpty()
    .withMessage("Properti tidak boleh kosong.")
    .bail()
    .custom((value) => {
      try {
        const parsed = typeof value === "string" ? JSON.parse(value) : value;
        if (typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error();
        }
        if (!parsed.id) {
          throw new Error("Properti harus memiliki ID untuk proses update.");
        }
        return true;
      } catch (err) {
        throw new Error(
          "Properti harus berupa JSON string yang valid dan memiliki ID."
        );
      }
    }),
];
