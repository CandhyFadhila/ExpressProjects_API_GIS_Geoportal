const knex = require("../../config/database");
const {
  resolveArrayRelations,
} = require("../../helpers/resolveArrayRelations");
const serializeLayer = require("../Layers/serializeLayer");
const {
  convertShapefileRowsToGeoJSON,
} = require("../../helpers/shapefileToGeoJSONHelper");

async function layerdataResource(layerData) {
  const layer = await knex("layers")
    .where("id", layerData.layer_id)
    .whereNull("deleted_at")
    .first();

  const serializedLayer = layer ? await serializeLayer(layer) : null;

  let bbox = null;
  let bbox_center = null;
  let geojson = null;

  try {
    const rows = await knex(layer.table_name).select("id", "geom");
    const geojsonResult = convertShapefileRowsToGeoJSON(rows);
    geojson = geojsonResult;
    bbox = geojsonResult.bbox;
    bbox_center = geojsonResult.center;
  } catch (err) {
    console.error(
      `❌ Gagal generate GeoJSON dari ${layer?.table_name}:`,
      err.message
    );
  }

  return {
    id: layerData.id,
    layer_id: serializedLayer,
    documents: await resolveArrayRelations(
      layerData.document_ids || [],
      "documents"
    ),
    bbox,
    bbox_center,
    geojson,
    created_at: layerData.created_at,
    updated_at: layerData.updated_at,
    deleted_at: layerData.deleted_at,
  };
}

module.exports = layerdataResource;
