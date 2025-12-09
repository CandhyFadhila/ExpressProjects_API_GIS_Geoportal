function applyFilters(queryBuilder, filters, rules) {
  Object.keys(filters).forEach((key) => {
    const value = filters[key];
    if (rules[key] && typeof rules[key] === "function") {
      rules[key](queryBuilder, value);
    }
  });

  return queryBuilder;
}

function applySearch(queryBuilder, search, columns) {
  if (!search || columns.length === 0) return queryBuilder;

  queryBuilder.where(function () {
    columns.forEach((column) => {
      this.orWhere(column, "ilike", `%${search}%`);
    });
  });

  return queryBuilder;
}

function applyPagination(queryBuilder, { page = 1, limit = 10 }) {
  const offset = (page - 1) * limit;
  queryBuilder.limit(limit).offset(offset);
  return { page: parseInt(page), limit: parseInt(limit) };
}

async function formatPaginationResult(
  queryBuilder,
  paginationInfo,
  knexInstance
) {
  const data = await queryBuilder;
  const [{ count }] = await knexInstance
    .count("*")
    .from(queryBuilder.clone().clearSelect().clearOrder().as("subquery"));

  const total = parseInt(count);
  const lastPage = Math.ceil(total / paginationInfo.limit);

  return {
    data,
    pagination: {
      meta: {
        current_page: paginationInfo.page,
        last_page: lastPage,
        per_page: paginationInfo.limit,
        total,
      },
      links: {
        first: `?page=1&limit=${paginationInfo.limit}`,
        last: `?page=${lastPage}&limit=${paginationInfo.limit}`,
        prev:
          paginationInfo.page > 1
            ? `?page=${paginationInfo.page - 1}&limit=${paginationInfo.limit}`
            : null,
        next:
          paginationInfo.page < lastPage
            ? `?page=${paginationInfo.page + 1}&limit=${paginationInfo.limit}`
            : null,
      },
    },
  };
}

module.exports = {
  applyFilters,
  applySearch,
  applyPagination,
  formatPaginationResult,
};
