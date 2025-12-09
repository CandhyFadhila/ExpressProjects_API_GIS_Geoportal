const workspaceResource = require("../../resources/Workspaces/workspaceResource");
const knex = require("../../config/database");
const layerdataResource = require("../LayerData/layerdataResource");

async function layersResource(layer, depth = 0) {
  const MAX_DEPTH = 3; // batas maksimum untuk menghindari infinite recursion
  const workspace = layer.workspace_id
    ? await knex("workspaces").where("id", layer.workspace_id).first()
    : null;

  const parentLayer =
    layer.parent_layer_id && depth < MAX_DEPTH
      ? await knex("layers").where("id", layer.parent_layer_id).first()
      : null;

  let layerData = [];
  try {
    const rows = await knex(layer.table_name).select("*");
    layerData = await Promise.all(rows.map((row) => layerdataResource(row)));
  } catch (err) {
    console.error(
      `❌ Error load layerData dari ${layer.table_name}:`,
      err.message
    );
    layerData = [];
  }

  return {
    id: layer.id,
    workspace: workspace ? await workspaceResource(workspace) : null,
    parent_layer_id: parentLayer
      ? await layersResource(parentLayer, depth + 1)
      : null,
    name: layer.name,
    description: layer.description,
    table_name: layer.table_name,
    data: layerData,
    created_at: layer.created_at,
    updated_at: layer.updated_at,
    deleted_at: layer.deleted_at,
  };
}

module.exports = layersResource;
