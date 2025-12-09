const express = require("express");
const router = express.Router();
const layersController = require("../../controllers/Layers/layersController");
const validate = require("../../middlewares/validate");
const {
  storeLayerValidator,
} = require("../../validators/Layers/storeLayerValidator");
const {
  updateLayerValidator,
} = require("../../validators/Layers/updateLayerValidator");
const {
  updateShpGeoDataValidator,
} = require("../../validators/Layers/updateShpGeoDataValidator");
const {
  updateColorLayerValidator,
} = require("../../validators/Layers/updateColorLayerValidator");
const authMiddleware = require("../../middlewares/authMiddleware");
const { roleMiddleware, ROLES } = require("../../middlewares/roleMiddleware");
const rateLimiter = require("../../middlewares/rateLimitMiddleware");
const upload = require("../../middlewares/multerMiddleware");

router.get(
  "/load/:workspace_id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER, ROLES.VIEWER]),
  layersController.getLayersbyWorkspaceId
);

router.get(
  "/layers-by-workspace/:workspace_id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER, ROLES.VIEWER]),
  layersController.getLayersbyWorkspaceIdWithoutGeojson
);

router.patch(
  "/update-field",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  upload.fields([
    { name: "sk_document", maxCount: 5 },
    { name: "other_document", maxCount: 5 },
    { name: "images", maxCount: 5 },
  ]),
  updateShpGeoDataValidator,
  validate,
  layersController.updateLayerFeatures
);

router.post(
  "/create",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  upload.array("file", 1),
  storeLayerValidator,
  validate,
  layersController.store
);

router.patch(
  "/update/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  upload.array("file", 1),
  updateLayerValidator,
  validate,
  layersController.update
);

router.delete(
  "/delete/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  layersController.destroy
);

router.get(
  "/property/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER, ROLES.VIEWER]),
  layersController.getLayerPropertiesbyLayerId
);

router.post(
  "/property-value/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  layersController.getLayerPropertiesValuebyLayerId
);

router.patch(
  "/update-color/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  updateColorLayerValidator,
  validate,
  layersController.updateLayerColor
);

router.patch(
  "/update-color-key/:id",
  rateLimiter,
  authMiddleware,
  roleMiddleware([ROLES.SUPER_ADMIN, ROLES.REGULER]),
  layersController.updateLayerColorbyPropertyKey
);

module.exports = router;
