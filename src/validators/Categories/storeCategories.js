const { body } = require("express-validator");

exports.storeCategoriesValidator = [
  body("label")
    .notEmpty()
    .withMessage("Judul kategori tidak boleh kosong.")
    .bail()
    .isString()
    .withMessage("Judul kategori harus berupa teks.")
    .bail()
    .isLength({ max: 255 })
    .withMessage("Judul kategori maksimal 255 karakter.")
];
