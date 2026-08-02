/**
 * Compression Middleware (Brotli & Gzip)
 * 
 * Provides response compression using Brotli (preferred) and Gzip (fallback).
 * Brotli provides better compression ratios than Gzip.
 * 
 * Features:
 * - Automatic Brotli compression with Gzip fallback
 * - Configurable compression thresholds
 * - Content-type filtering
 * - Compression statistics
 * 
 * Usage:
 *   const compression = require('./middleware/compression');
 *   app.use(compression.middleware());
 * 
 * Environment Variables:
 *   COMPRESSION_ENABLED: true/false (default: true)
 *   COMPRESSION_LEVEL: 0-11 (default: 6)
 *   COMPRESSION_THRESHOLD: bytes (default: 1024)
 *   COMPRESSION_TYPES: comma-separated content types (default: text/*, application/json, application/javascript)
 */

const zlib = require('zlib');
const logger = require('../utils/logger');
const prom = require('../utils/prometheus');

let compressionEnabled = process.env.COMPRESSION_ENABLED !== 'false';
let compressionLevel = parseInt(process.env.COMPRESSION_LEVEL || '6', 10);
let compressionThreshold = parseInt(process.env.COMPRESSION_THRESHOLD || '1024', 10);
let compressionTypes = (process.env.COMPRESSION_TYPES || 'text/*,application/json,application/javascript,application/xml,text/xml').split(',');

// Compression statistics
let compressionStats = {
  totalRequests: 0,
  compressedResponses: 0,
  uncompressedResponses: 0,
  totalOriginalBytes: 0,
  totalCompressedBytes: 0
};

/**
 * Check if content type should be compressed
 */
function shouldCompress(contentType) {
  if (!contentType) return false;
  
  return compressionTypes.some(type => {
    if (type.includes('*')) {
      const regex = new RegExp(type.replace('*', '.*'));
      return regex.test(contentType);
    }
    return contentType.includes(type);
  });
}

/**
 * Check if response should be compressed based on size
 */
function shouldCompressBySize(size) {
  return size >= compressionThreshold;
}

/**
 * Compress data using Brotli
 */
function compressBrotli(data, level = compressionLevel) {
  return new Promise((resolve, reject) => {
    zlib.brotliCompress(data, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: level
      }
    }, (error, compressed) => {
      if (error) {
        reject(error);
      } else {
        resolve(compressed);
      }
    });
  });
}

/**
 * Compress data using Gzip
 */
function compressGzip(data, level = compressionLevel) {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, { level }, (error, compressed) => {
      if (error) {
        reject(error);
      } else {
        resolve(compressed);
      }
    });
  });
}

/**
 * Compression middleware
 */
function compressionMiddleware(options = {}) {
  const {
    enabled = compressionEnabled,
    level = compressionLevel,
    threshold = compressionThreshold,
    types = compressionTypes
  } = options;

  compressionEnabled = enabled;
  compressionLevel = level;
  compressionThreshold = threshold;
  compressionTypes = types;

  return (req, res, next) => {
    if (!compressionEnabled) {
      return next();
    }

    // Check if client accepts Brotli or Gzip
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const acceptsBrotli = acceptEncoding.includes('br');
    const acceptsGzip = acceptEncoding.includes('gzip');

    if (!acceptsBrotli && !acceptsGzip) {
      return next();
    }

    // Store original res.end
    const originalEnd = res.end.bind(res);
    const originalWrite = res.write.bind(res);
    
    let chunks = [];
    let originalSize = 0;

    // Intercept res.write to collect data
    res.write = function(chunk, encoding, callback) {
      if (typeof chunk === 'string') {
        chunk = Buffer.from(chunk, encoding || 'utf8');
      }
      chunks.push(chunk);
      originalSize += chunk.length;
      
      if (callback) callback();
      return true;
    };

    // Intercept res.end to compress data
    res.end = function(chunk, encoding, callback) {
      if (chunk) {
        if (typeof chunk === 'string') {
          chunk = Buffer.from(chunk, encoding || 'utf8');
        }
        chunks.push(chunk);
        originalSize += chunk.length;
      }

      compressionStats.totalRequests++;

      // Combine chunks
      const body = Buffer.concat(chunks);
      const contentType = res.getHeader('Content-Type');

      // Check if should compress
      if (shouldCompress(contentType) && shouldCompressBySize(originalSize)) {
        compressionStats.totalOriginalBytes += originalSize;

        // Try Brotli first, fallback to Gzip
        const compressMethod = acceptsBrotli ? compressBrotli : compressGzip;
        const encoding = acceptsBrotli ? 'br' : 'gzip';

        compressMethod(body, level)
          .then(compressed => {
            compressionStats.totalCompressedBytes += compressed.length;
            compressionStats.compressedResponses++;

            // Update headers
            res.setHeader('Content-Encoding', encoding);
            res.setHeader('Content-Length', compressed.length);
            res.setHeader('X-Compression-Ratio', ((1 - compressed.length / originalSize) * 100).toFixed(2) + '%');
            res.removeHeader('Content-Length'); // Remove old length

            // Send compressed data
            originalEnd(compressed, callback);

            // Emit Prometheus metric
            prom.cacheHitsTotal.inc(); // Reuse for compression hits
          })
          .catch(error => {
            logger.warn('[compression] Compression failed, sending uncompressed:', error.message);
            compressionStats.uncompressedResponses++;
            
            // Send uncompressed on error
            res.setHeader('Content-Length', originalSize);
            originalEnd(body, callback);
          });
      } else {
        compressionStats.uncompressedResponses++;
        res.setHeader('Content-Length', originalSize);
        originalEnd(body, callback);
      }
    };

    next();
  };
}

/**
 * Get compression statistics
 */
function getStats() {
  const compressionRatio = compressionStats.totalOriginalBytes > 0
    ? ((1 - compressionStats.totalCompressedBytes / compressionStats.totalOriginalBytes) * 100).toFixed(2)
    : 0;

  return {
    ...compressionStats,
    compressionRatio: compressionRatio + '%',
    avgCompressionRatio: compressionRatio + '%',
    enabled: compressionEnabled,
    level: compressionLevel,
    threshold: compressionThreshold
  };
}

/**
 * Reset compression statistics
 */
function resetStats() {
  compressionStats = {
    totalRequests: 0,
    compressedResponses: 0,
    uncompressedResponses: 0,
    totalOriginalBytes: 0,
    totalCompressedBytes: 0
  };
}

/**
 * Pre-configured compression strategies
 */

// Maximum compression (best ratio, slower)
const maxCompression = {
  level: 11,
  threshold: 512
};

// Balanced (good ratio, moderate speed)
const balancedCompression = {
  level: 6,
  threshold: 1024
};

// Fast compression (lower ratio, faster)
const fastCompression = {
  level: 3,
  threshold: 2048
};

// No compression
const noCompression = {
  enabled: false
};

module.exports = {
  middleware: compressionMiddleware,
  shouldCompress,
  shouldCompressBySize,
  compressBrotli,
  compressGzip,
  getStats,
  resetStats,
  maxCompression,
  balancedCompression,
  fastCompression,
  noCompression
};
