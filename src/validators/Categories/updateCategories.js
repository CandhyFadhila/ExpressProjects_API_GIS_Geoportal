const { body } = require("express-validator");

exports.updateCategoriesValidator = [
  body("label")
    .optional()
    .isString()
    .withMessage("Judul kategori harus berupa teks.")
    .isLength({ max: 255 })
    .withMessage("Judul kategori maksimal 255 karakter.")
];
