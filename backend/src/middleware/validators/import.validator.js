/**
 * Import — file presence validation middleware
 *
 * Validates that a file was uploaded with the request.
 * Must be used AFTER multer processes the upload.
 * Returns HTTP 400 if no file is present.
 */

const { errorResponse } = require('../../utils/response');

/**
 * Middleware: ensure req.file exists (single-file upload).
 * Use after multer's upload.single() or upload.fields() middleware.
 */
function requireFile(req, res, next) {
  if (!req.file) {
    return errorResponse(res, 'A file upload is required', 400, [
      { field: 'file', message: 'No file was uploaded' },
    ]);
  }
  next();
}

/**
 * Middleware: ensure at least one file exists in req.files (multi-file upload).
 */
function requireFiles(req, res, next) {
  const files = Array.isArray(req.files)
    ? req.files
    : Object.values(req.files || {}).flat();
  if (!files.length) {
    return errorResponse(res, 'A file upload is required', 400, [
      { field: 'file', message: 'No file was uploaded' },
    ]);
  }
  next();
}

module.exports = { requireFile, requireFiles };
