const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { loginValidator } = require("../validators/loginValidator");
const { resetPasswordValidator } = require("../validators/resetPasswordValidator");
const { verifyOTPValidator } = require("../validators/verifyOTPValidator");
const { sendOTPValidator } = require("../validators/sendOTPValidator");
const validate = require("../middlewares/validate");
const authMiddleware = require("../middlewares/authMiddleware");
const rateLimiter = require("../middlewares/rateLimitMiddleware");

// Auth
router.post("/signin", rateLimiter, loginValidator, authController.login);
router.get("/user-info", rateLimiter, authMiddleware, authController.getUserInfo);
router.get("/signout", rateLimiter, authMiddleware, authController.logout);

// Reset Password via OTP
router.post("/send-otp", rateLimiter, sendOTPValidator, validate, authController.sendOTP);
router.post("/verify-otp", rateLimiter, verifyOTPValidator, validate, authController.verifyOTP);
router.post("/reset-password", rateLimiter, resetPasswordValidator, validate, authController.resetPassword);

module.exports = router;
