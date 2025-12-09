const knex = require("../../config/database");

async function serializeLayer(layer, depth = 0) {
  const MAX_DEPTH = 3;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  return {
    id: layer.id,
    parent_layer_id: parentLayer
      ? await serializeLayer(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    is_boundary: layer.is_boundary,
    table_name: layer.table_name,
    layer_type: layer.layer_type,
    with_explanation: layer.with_explanation,
    color_property_key: layer.color_property_key,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

module.exports = serializeLayer;
