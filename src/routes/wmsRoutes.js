const express = require("express");
const router = express.Router();
const wmsController = require("../controllers/wmsController");
const validate = require("../middlewares/validate");
const { wmsValidator } = require("../validators/wmsValidator");
const authMiddleware = require("../middlewares/authMiddleware");
const rateLimiter = require("../middlewares/rateLimitMiddleware");

router.get("/wms-image", rateLimiter, authMiddleware, wmsValidator, validate, wmsController.getWMSImage);

module.exports = router;
