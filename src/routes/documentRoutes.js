const express = require("express");
const router = express.Router();
const documentController = require("../controllers/documentController");
const upload = require("../middlewares/multerMiddleware");

router.post("/upload-documents", upload.array("files", 5), documentController.uploadDocuments);
router.delete("/delete-documents", documentController.deleteDocuments);

module.exports = router;