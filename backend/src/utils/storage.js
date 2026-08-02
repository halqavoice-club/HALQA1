'use strict';

/**
 * Storage Utility — Cloudflare R2 (primary) with local fallback for dev
 * ─────────────────────────────────────────────────────────────────────────────
 * Production: Cloudflare R2 (S3-compatible object storage)
 * Development: local disk (uploads/) when STORAGE_TYPE=local
 *
 * Environment variables:
 *   STORAGE_TYPE          'r2' | 'local'   (default: 'local')
 *
 *   R2 (production):
 *     R2_ACCOUNT_ID         Cloudflare account ID
 *     R2_ACCESS_KEY_ID      R2 API token → Access Key ID
 *     R2_SECRET_ACCESS_KEY  R2 API token → Secret Access Key
 *     R2_BUCKET             Bucket name (e.g. halqa-uploads)
 *     R2_PUBLIC_URL         Public bucket URL
 *                           e.g. https://pub-xxx.r2.dev
 *                           or   https://files.yourdomain.com
 *
 * File categories and size limits:
 *   avatars   → images only, 5 MB
 *   logos     → images only, 2 MB
 *   audio     → audio only, 50 MB
 *   covers    → images only, 2 MB
 *   reports   → PDF only, 20 MB
 *   uploads   → general, 10 MB
 *
 * Usage:
 *   const { saveFile, deleteFile, getFileUrl } = require('./storage')
 *   const { url, key } = await saveFile(buffer, filename, mimeType, 'avatars')
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path   = require('path');
const fs     = require('fs');
const logger = require('./logger');

const STORAGE_TYPE = (process.env.STORAGE_TYPE || 'local').toLowerCase();

// ─── File validation rules per folder ────────────────────────────────────────
const FOLDER_RULES = {
  avatars: {
    maxBytes:     5  * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  logos: {
    maxBytes:     2  * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
  },
  audio: {
    maxBytes:     50 * 1024 * 1024,
    allowedTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/mp4'],
  },
  covers: {
    maxBytes:     2  * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  reports: {
    maxBytes:     20 * 1024 * 1024,
    allowedTypes: ['application/pdf'],
  },
  // Post/story media — images and videos uploaded from the feed composer
  media: {
    maxBytes:     50 * 1024 * 1024,
    allowedTypes: [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp',
    ],
  },
  uploads: {
    maxBytes:     10 * 1024 * 1024,
    allowedTypes: [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
    ],
  },
};

/**
 * Validate a file buffer against folder rules.
 * Throws an error with a user-friendly message if validation fails.
 */
function validateFile(buffer, mimeType, folder) {
  const rules = FOLDER_RULES[folder] || FOLDER_RULES.uploads;

  if (buffer.length > rules.maxBytes) {
    const maxMB = (rules.maxBytes / 1024 / 1024).toFixed(0);
    throw Object.assign(
      new Error(`File too large. Maximum size for ${folder} is ${maxMB} MB`),
      { statusCode: 413 }
    );
  }

  if (!rules.allowedTypes.includes(mimeType)) {
    throw Object.assign(
      new Error(`File type "${mimeType}" is not allowed in ${folder}. Allowed: ${rules.allowedTypes.join(', ')}`),
      { statusCode: 415 }
    );
  }
}

// ─── LOCAL STORAGE (development only) ────────────────────────────────────────

function getLocalUrl(key) {
  return `/uploads/${key}`;
}

function saveLocalFile(buffer, key) {
  const fullPath = path.join(process.cwd(), 'uploads', key);
  const dir      = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, buffer);
  return getLocalUrl(key);
}

function deleteLocalFile(key) {
  try {
    // Accept both a key ('avatars/file.jpg') and a local URL ('/uploads/avatars/file.jpg')
    const normalised = key.startsWith('/uploads/')
      ? key.slice('/uploads/'.length)
      : key;
    const fullPath = path.join(process.cwd(), 'uploads', normalised);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    return true;
  } catch (err) {
    logger.warn(`[storage] Could not delete local file "${key}": ${err.message}`);
    return false;
  }
}

// ─── R2 / S3 CLIENT ──────────────────────────────────────────────────────────

let _s3Client = null;

function getS3Client() {
  if (_s3Client) return _s3Client;

  const { S3Client } = require('@aws-sdk/client-s3');

  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) {
    throw new Error(
      'R2_ACCOUNT_ID is not set. ' +
      'Set STORAGE_TYPE=local for development or configure R2 credentials.'
    );
  }

  _s3Client = new S3Client({
    region:   'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID     || '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    },
    // R2 does not support path-style URLs — force virtual-hosted style
    forcePathStyle: false,
  });

  return _s3Client;
}

const R2_BUCKET = () => process.env.R2_BUCKET || 'halqa-uploads';

function buildR2PublicUrl(key) {
  const base = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!base) {
    logger.warn('[storage] R2_PUBLIC_URL is not set — files will not be publicly accessible via CDN');
    // Fall back to the R2 storage URL (not publicly accessible without bucket policy)
    return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET()}/${key}`;
  }
  return `${base}/${key}`;
}

// ─── R2 UPLOAD ────────────────────────────────────────────────────────────────

/**
 * Upload a buffer to R2.
 * Retries once on transient network errors.
 *
 * @param {Buffer} buffer
 * @param {string} key       - Object key (e.g. 'avatars/uuid.jpg')
 * @param {string} mimeType
 * @returns {Promise<string>} Public URL
 */
async function uploadToR2(buffer, key, mimeType) {
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const client = getS3Client();

  const params = {
    Bucket:        R2_BUCKET(),
    Key:           key,
    Body:          buffer,
    ContentType:   mimeType,
    ContentLength: buffer.length,
    // R2 does NOT support ACL — public access is controlled at bucket level
  };

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await client.send(new PutObjectCommand(params));
      return buildR2PublicUrl(key);
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        logger.warn(`[storage] R2 upload attempt ${attempt} failed for "${key}": ${err.message} — retrying`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  logger.error(`[storage] R2 upload failed for "${key}" after 2 attempts: ${lastError.message}`);
  throw lastError;
}

// ─── R2 DELETE ────────────────────────────────────────────────────────────────

/**
 * Delete an object from R2 by key.
 * Accepts either a key ('avatars/file.jpg') or a full public URL.
 *
 * @param {string} keyOrUrl
 * @returns {Promise<boolean>}
 */
async function deleteFromR2(keyOrUrl) {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = getS3Client();

  // Extract key from URL if a full URL was passed
  let key = keyOrUrl;
  if (keyOrUrl.startsWith('http')) {
    try {
      const parsed = new URL(keyOrUrl);
      // Strip leading slash from pathname
      key = parsed.pathname.slice(1);
    } catch {
      logger.warn(`[storage] Could not parse URL for deletion: ${keyOrUrl}`);
      return false;
    }
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET(), Key: key }));
    logger.debug(`[storage] Deleted R2 object: ${key}`);
    return true;
  } catch (err) {
    logger.error(`[storage] R2 delete failed for "${key}": ${err.message}`);
    return false;
  }
}

// ─── SIGNED URL (for private files) ──────────────────────────────────────────

/**
 * Generate a pre-signed URL for temporary access to a private R2 object.
 * Default expiry: 1 hour.
 *
 * @param {string} key
 * @param {number} [expiresInSeconds=3600]
 * @returns {Promise<string>}
 */
async function generateSignedUrl(key, expiresInSeconds = 3600) {
  if (STORAGE_TYPE !== 'r2') {
    return getLocalUrl(key);
  }

  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const client = getS3Client();

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: R2_BUCKET(), Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Save a file buffer to the configured storage backend.
 *
 * @param {Buffer} buffer
 * @param {string} filename   - Unique filename (caller generates with uuid)
 * @param {string} mimeType
 * @param {string} [folder]   - Sub-folder: 'avatars' | 'audio' | 'logos' | 'covers' | 'reports' | 'uploads'
 * @returns {Promise<{ url: string, key: string, storageType: string }>}
 */
async function saveFile(buffer, filename, mimeType, folder = 'uploads') {
  // Validate before touching any storage backend
  validateFile(buffer, mimeType, folder);

  const key = folder ? `${folder}/${filename}` : filename;

  if (STORAGE_TYPE === 'r2') {
    const url = await uploadToR2(buffer, key, mimeType);
    logger.debug(`[storage] Uploaded to R2: ${key}`);
    return { url, key, storageType: 'r2' };
  }

  // Local (development)
  const url = saveLocalFile(buffer, key);
  logger.debug(`[storage] Saved locally: ${key}`);
  return { url, key, storageType: 'local' };
}

/**
 * Delete a file from whichever backend stored it.
 * Accepts a full URL (https://...) or a key/path.
 *
 * @param {string} urlOrKey
 * @returns {Promise<boolean>}
 */
async function deleteFile(urlOrKey) {
  if (!urlOrKey) return false;

  if (STORAGE_TYPE === 'r2') {
    return deleteFromR2(urlOrKey);
  }

  // Local
  return deleteLocalFile(urlOrKey);
}

/**
 * Get the public URL for a stored file given its key.
 *
 * @param {string} key  - e.g. 'avatars/uuid.jpg'
 * @returns {string}
 */
function getFileUrl(key) {
  if (!key) return null;
  if (STORAGE_TYPE === 'r2') return buildR2PublicUrl(key);
  return getLocalUrl(key);
}

/**
 * Extract the storage key from a full URL.
 * Useful when you have a URL stored in the DB and need the key for deletion.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractKeyFromUrl(url) {
  if (!url) return null;
  if (!url.startsWith('http')) return url; // already a key or local path

  try {
    const parsed = new URL(url);
    return parsed.pathname.slice(1); // strip leading /
  } catch {
    return null;
  }
}

function isCloudStorage() {
  return STORAGE_TYPE === 'r2';
}

module.exports = {
  saveFile,
  deleteFile,
  getFileUrl,
  generateSignedUrl,
  extractKeyFromUrl,
  isCloudStorage,
  validateFile,
  STORAGE_TYPE,
  FOLDER_RULES,
  // Exposed for direct use (e.g. cleanup worker)
  getS3Client,
  R2_BUCKET,
};
