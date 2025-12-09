const { body } = require("express-validator");

exports.resetPasswordValidator = [
  body("email")
    .notEmpty()
    .withMessage("Email tidak boleh kosong.")
    .bail()
    .isEmail()
    .withMessage(
      "Silahkan masukkan email yang valid, bisa berupa @gmail atau yang lain."
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
  body("password")
    .notEmpty()
    .withMessage("Password tidak boleh kosong.")
    .bail()
    .isLength({ min: 8 })
    .withMessage("Password minimal terdiri dari 8 karakter."),
  body("password_confirmation")
    .notEmpty()
    .withMessage("Konfirmasi password tidak boleh kosong.")
    .bail()
    .custom((value, { req }) => value === req.body.password)
    .withMessage(
      "Konfirmasi password tidak cocok. Pastikan password yang anda masukkan sudah sesuai."
    ),
];
