const { body } = require("express-validator");

exports.sendOTPValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email tidak boleh kosong.")
    .bail()
    .isEmail()
    .withMessage(
      "Silahkan masukkan email yang valid, bisa berupa @gmail atau yang lain."
    ),
];
