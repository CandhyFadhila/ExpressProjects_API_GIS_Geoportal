const { query } = require("express-validator");

exports.wmsValidator = [
  query("width")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Parameter 'width' harus berupa angka bulat positif."),

  query("height")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Parameter 'height' harus berupa angka bulat positif."),

  query("format")
    .optional()
    .isIn([
      "image/png",
      "image/jpeg",
      "image/svg"
    ])
    .withMessage("Format gambar tidak didukung."),
];
