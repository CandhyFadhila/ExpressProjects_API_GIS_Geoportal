const express = require("express");
const router = express.Router();
const workspaceController = require("../../controllers/Workspaces/workspaceController");
const validate = require("../../middlewares/validate");
const {
  storeWorkspaceValidator,
} = require("../../validators/Workspaces/storeWorkspaceValidator");
const {
  updateWorkspaceValidator,
} = require("../../validators/Workspaces/updateWorkspaceValidator");
const authMiddleware = require("../../middlewares/authMiddleware");
const { roleMiddleware, ROLES } = require("../../middlewares/roleMiddleware");
const rateLimiter = require("../../middlewares/rateLimitMiddleware");
const upload = require("../../middlewares/multerMiddleware");

router.get(
  "/index",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER, ROLES.VIEWER]),
  workspaceController.index
);

router.get(
  "/show/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER, ROLES.VIEWER]),
  workspaceController.show
);

router.post(
  "/create",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  upload.array("thumbnail", 1),
  storeWorkspaceValidator,
  validate,
  workspaceController.store
);

router.patch(
  "/update/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  upload.array("thumbnail", 1),
  updateWorkspaceValidator,
  validate,
  workspaceController.update
);

router.delete(
  "/delete/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  workspaceController.destroy
);

module.exports = router;
