const { body } = require("express-validator");

exports.loginValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email tidak boleh kosong.")
    .bail()
    .isEmail()
    .withMessage(
      "Silahkan masukkan email yang valid, bisa berupa @gmail atau yang lain."
    ),
  body("password")
    .notEmpty()
    .withMessage("Password tidak boleh kosong.")
    .bail()
    .isLength({ min: 8 })
    .withMessage("Password minimal terdiri dari 8 karakter."),
];
