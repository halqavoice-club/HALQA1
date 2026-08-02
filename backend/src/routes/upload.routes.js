const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth.middleware');
const prisma = require('../utils/prisma');
const { saveFile, STORAGE_TYPE } = require('../utils/storage');
const { successResponse, errorResponse } = require('../utils/response');
const { fromBuffer: fileTypeFromBuffer } = require('file-type');
const clamav = require('../utils/clamav');

// ─── Allowed MIME types ───────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/mpeg', 'audio/wav', 'audio/ogg',
];

// ─── Use memory storage — saveFile() decides local vs S3 ─────────────────────
const fileFilter = (req, file, cb) => {
  ALLOWED_MIME_TYPES.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('File type not allowed'), false);
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

  if (!detectedMime || !ALLOWED_MIME_TYPES.includes(detectedMime)) {
    return `File type not allowed (detected: ${detectedMime || 'unknown'})`;
  }

  // ClamAV scan — only when ClamAV daemon is reachable
  if (clamav.isEnabled()) {
    const scanResult = await clamav.scanBuffer(buffer);
    if (!scanResult.clean) {
      return 'File rejected: malware detected';
    }
  }

  return null; // validation passed
}

router.use(authenticate);

// ─── POST /uploads — single file ─────────────────────────────────────────────
router.post('/', upload.single('file'), async (req, res, next) => {
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
router.post('/multiple', upload.array('files', 10), async (req, res, next) => {
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
