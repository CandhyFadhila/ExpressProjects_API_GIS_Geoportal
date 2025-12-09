const { body } = require("express-validator");

// Hex color: #RGB, #RRGGBB, #RRGGBBAA
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Kolom yang dilarang untuk property_key
const RESERVED_KEYS = ["id", "geom", "layer_id", "document_ids", "color"];

exports.updateColorLayerValidator = [
  body("property_key")
    .optional()
    .isString()
    .withMessage("Property key harus berupa teks.")
    .trim()
    .isLength({ min: 1, max: 63 })
    .withMessage("Property key maksimal 63 karakter.")
    .matches(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .withMessage(
      "Property key hanya boleh berisi huruf/angka/underscore dan tidak boleh diawali angka."
    )
    .custom((value) => {
      if (RESERVED_KEYS.includes(String(value).toLowerCase())) {
        throw new Error(
          "Property key tidak boleh menggunakan nama kolom terproteksi (layer_id, document_ids, color)."
        );
      }
      return true;
    }),

  body("colorscale")
    .optional()
    .custom((value) => {
      if (!Array.isArray(value)) {
        throw new Error("Colorscale harus berupa array.");
      }
      if (value.length === 0) {
        throw new Error("Colorscale tidak boleh kosong.");
      }
      if (value.length > 256) {
        throw new Error("Colorscale terlalu panjang (maksimal 256 warna).");
      }
      const allValid = value.every(
        (c) => typeof c === "string" && HEX_RE.test(c)
      );
      if (!allValid) {
        throw new Error(
          "Setiap item colorscale harus string warna hex valid (#RGB, #RRGGBB, atau #RRGGBBAA)."
        );
      }
      return true;
    }),

  body().custom((_, { req }) => {
    const hasKey =
      typeof req.body.property_key === "string" &&
      req.body.property_key.trim() !== "";
    const hasScale =
      Array.isArray(req.body.colorscale) && req.body.colorscale.length > 0;
    if (hasKey !== hasScale) {
      throw new Error(
        "Jika ingin menerapkan color, 'property_key' dan 'colorscale' harus dikirim bersamaan."
      );
    }
    return true;
  }),
];
