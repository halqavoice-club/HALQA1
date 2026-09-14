const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const prisma = require('../utils/prisma');
const { saveFile, STORAGE_TYPE } = require('../utils/storage');
const { successResponse, errorResponse } = require('../utils/response');
const { fromBuffer: fileTypeFromBuffer } = require('file-type');
const clamav = require('../utils/clamav');

// ─── L-3 FIX: Per-user rate limits on upload endpoints ───────────────────────
// Single file: 20 uploads per minute per user
// Multiple files: 4 batch uploads per minute per user
// These limits prevent storage/bandwidth exhaustion from a single abusive account.
const singleUploadLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many uploads, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

const multipleUploadLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 4,
  keyGenerator: req => req.user?.id || req.ip,
  message: { success: false, message: 'Too many batch uploads, slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Allowed MIME types ───────────────────────────────────────────────────────
// Note: file-type magic byte detection may return slightly different strings
// than browser-declared mimetypes. Both sets are included here.
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'image/heic', 'image/heif', 'image/avif', 'image/svg+xml', 'image/bmp',
  'image/tiff', 'image/x-icon',
  // Videos
  'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp', 'video/3gpp2',
  'video/x-m4v', 'video/x-msvideo', 'video/x-matroska', 'video/ogg',
  // Audio
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/wav', 'audio/x-wav',
  'audio/ogg', 'audio/aac', 'audio/m4a', 'audio/x-m4a', 'audio/flac',
  'audio/webm', 'audio/x-flac',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Archives (safe for DM file sharing)
  'application/zip', 'application/x-zip-compressed',
  // Text
  'text/plain', 'text/csv',
]);

// ─── Use memory storage — saveFile() decides local vs S3 ─────────────────────
const fileFilter = (req, file, cb) => {
  ALLOWED_MIME_TYPES.has(file.mimetype)
    ? cb(null, true)
    : cb(new Error(`File type not allowed: ${file.mimetype}`), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB (videos need more headroom)
});

/**
 * Validate a file buffer's magic bytes and run ClamAV scan if enabled.
 * Returns null on success, or an error message string on failure.
 */
async function validateFileBuffer(buffer) {
  // Magic bytes validation — check actual file signature, not declared MIME
  const detected = await fileTypeFromBuffer(buffer);
  const detectedMime = detected ? detected.mime : null;

  // Some valid files (plain text, CSV, SVG, certain audio) have no magic bytes.
  // If file-type can't detect, fall back to allowing it (multer already filtered
  // by declared MIME, which is checked above in fileFilter).
  if (detectedMime && !ALLOWED_MIME_TYPES.has(detectedMime)) {
    // Allow common aliases (file-type returns 'image/jpg' but we store 'image/jpeg' etc.)
    const normalized = detectedMime
      .replace('image/jpg', 'image/jpeg')
      .replace('audio/mp3', 'audio/mpeg')
      .replace('audio/x-wav', 'audio/wav')
    if (!ALLOWED_MIME_TYPES.has(normalized)) {
      return `File type not allowed (detected: ${detectedMime})`;
    }
  }

  // ClamAV scan — only when the daemon has been confirmed reachable.
  if (clamav.isEnabled()) {
    try {
      const scanResult = await clamav.scanBuffer(buffer);
      const hasVirus = scanResult &&
        scanResult.clean === false &&
        !scanResult.error &&
        Array.isArray(scanResult.viruses) &&
        scanResult.viruses.length > 0;
      if (hasVirus) {
        return 'File rejected: malware detected';
      }
    } catch {
      // ClamAV unreachable — fail-open, allow upload to proceed
    }
  }

  return null; // validation passed
}

router.use(authenticate);

// ─── POST /uploads — single file ─────────────────────────────────────────────
router.post('/', singleUploadLimit, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 'No file uploaded', 400);

    // Magic bytes + ClamAV validation
    const validationError = await validateFileBuffer(req.file.buffer);
    if (validationError) return errorResponse(res, validationError, 400);

    const ext      = path.extname(req.file.originalname);
    const filename = `${uuidv4()}${ext}`;
    const { url, storageType } = await saveFile(
      req.file.buffer,
      filename,
      req.file.mimetype,
      'media'   // → saves to backend/uploads/media/ → served at /uploads/media/
    );

    const fileRecord = await prisma.fileUpload.create({
      data: {
        userId:       req.user.id,
        schoolId:     req.user.schoolId,
        filename,
        originalName: req.file.originalname,
        mimeType:     req.file.mimetype,
        size:         req.file.size,
        url,
        storageType,
        entityType:   req.body.entityType,
        entityId:     req.body.entityId,
      },
    });

    return successResponse(res, fileRecord, 'File uploaded', 201);
  } catch (error) { next(error); }
});

// ─── POST /uploads/multiple — up to 10 files ─────────────────────────────────
router.post('/multiple', multipleUploadLimit, upload.array('files', 10), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return errorResponse(res, 'No files uploaded', 400);
    }

    // Magic bytes + ClamAV validation for each file before any storage write
    for (const f of req.files) {
      const validationError = await validateFileBuffer(f.buffer);
      if (validationError) {
        return errorResponse(res, `${f.originalname}: ${validationError}`, 400);
      }
    }

    const saved = await Promise.all(
      req.files.map(async (f) => {
        const ext      = path.extname(f.originalname);
        const filename = `${uuidv4()}${ext}`;
        const { url, storageType } = await saveFile(f.buffer, filename, f.mimetype);
        return {
          userId:       req.user.id,
          schoolId:     req.user.schoolId,
          filename,
          originalName: f.originalname,
          mimeType:     f.mimetype,
          size:         f.size,
          url,
          storageType,
        };
      })
    );

    const records = await prisma.fileUpload.createMany({ data: saved });
    return successResponse(res, { count: records.count }, 'Files uploaded', 201);
  } catch (error) { next(error); }
});

module.exports = router;
