const { body } = require("express-validator");

exports.verifyOTPValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email tidak boleh kosong.")
    .bail()
    .isEmail()
    .withMessage(
      "Silahkan masukkan email yang valid, bisa berupa @gmail.com atau yang lain."
    ),

  body("otp")
    .notEmpty()
    .withMessage(
      "OTP tidak boleh kosong, silahkan masukkan kode OTP yang berasal dari email yang Anda terima."
    )
    .bail()
    .isNumeric()
    .withMessage("Kode OTP yang valid harus berupa angka.")
    .bail()
    .isLength({ min: 6, max: 6 })
    .withMessage("Kode OTP harus terdiri dari 6 digit."),
];
