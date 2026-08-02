/**
 * Standard API response helpers
 */

function successResponse(res, data = null, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString()
  });
}

function errorResponse(res, message = 'An error occurred', statusCode = 500, errors = null) {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString()
  };
  if (errors) response.errors = errors;
  return res.status(statusCode).json(response);
}

function paginatedResponse(res, data, pagination, message = 'Success') {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination,
    timestamp: new Date().toISOString()
  });
}

function getPagination(page = 1, limit = 20) {
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;
  return { page: pageNum, limit: limitNum, skip };
}

function buildPaginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
}

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
  getPagination,
  buildPaginationMeta
};
