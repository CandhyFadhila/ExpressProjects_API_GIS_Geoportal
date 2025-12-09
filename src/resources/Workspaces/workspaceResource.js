const {
  resolveArrayRelations,
} = require("../../helpers/resolveArrayRelations");
const categoriesResource = require("../Categories/categoriesResource");
const serializeLayer = require("../Layers/serializeLayer");
const knex = require("../../config/database");

async function workspaceResource(workspace) {
  const category = workspace.category_id
    ? await knex("workspace_categories")
        .where("id", workspace.category_id)
        .first()
    : null;

  // Ambil semua layers milik workspace (soft delete-aware)
  const layers = await knex("layers")
    .where("workspace_id", workspace.id)
    .whereNull("deleted_at")
    .orderBy("created_at", "desc");

  const serializedLayers = await Promise.all(
    layers.map((layer) => serializeLayer(layer))
  );

  return {
    id: workspace.id,
    created_by: workspace.created_by,
    title: workspace.title,
    description: workspace.description,
    thumbnail: await resolveArrayRelations(
      [workspace.document_id],
      "documents"
    ),
    workspace_category: category ? await categoriesResource(category) : null,
    layers: serializedLayers,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    deleted_at: workspace.deleted_at,
  };
}

module.exports = workspaceResource;
