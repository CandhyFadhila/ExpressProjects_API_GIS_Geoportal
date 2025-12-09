async function categoriesResource(categories) {
  return {
    id: categories.id,
    label: categories.label,
    created_at: categories.created_at,
    updated_at: categories.updated_at,
    deleted_at: categories.deleted_at,
  };
}

module.exports = categoriesResource;
