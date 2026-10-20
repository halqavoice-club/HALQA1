'use strict';
/**
 * Manual Jest mock for file-type@21.x (ESM-only package).
 *
 * Jest's module resolver cannot resolve ESM-only packages via jest.mock().
 * Placing this file at __mocks__/file-type.js (adjacent to node_modules)
 * allows Jest to use it automatically when jest.mock('file-type') is called,
 * bypassing the ESM resolver entirely.
 *
 * The mock exports fileTypeFromBuffer (v21 API) returning a default JPEG result.
 * Individual tests can override with mockResolvedValueOnce() as needed.
 */
const fileTypeFromBuffer = jest.fn().mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });

module.exports = { fileTypeFromBuffer };
