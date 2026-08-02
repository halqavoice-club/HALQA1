/**
 * Virus Scanning (ClamAV)
 * 
 * Provides virus scanning capabilities using ClamAV.
 * Supports:
 * - File scanning via ClamAV daemon
 * - Stream scanning
 * - Scan result caching
 * - Quarantine management
 * - Scan statistics
 * 
 * Usage:
 *   const clamav = require('./utils/clamav');
 *   
 *   // Scan file
 *   const result = await clamav.scanFile('/path/to/file');
 *   
 *   // Scan buffer
 *   const result = await clamav.scanBuffer(buffer);
 * 
 * Environment Variables:
 *   CLAMAV_HOST: ClamAV daemon host (default: localhost)
 *   CLAMAV_PORT: ClamAV daemon port (default: 3310)
 *   CLAMAV_ENABLED: true/false (default: true)
 *   QUARANTINE_DIR: Directory for quarantined files
 */

const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const { alertCritical } = require('./alerting');
const prom = require('./prometheus');

let client = null;
let enabled = process.env.CLAMAV_ENABLED !== 'false';
const host = process.env.CLAMAV_HOST || 'localhost';
const port = parseInt(process.env.CLAMAV_PORT || '3310', 10);
const quarantineDir = process.env.QUARANTINE_DIR || '/tmp/quarantine';
const scanCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

/**
 * Initialize ClamAV client
 */
async function initialize() {
  try {
    // Create quarantine directory
    await fs.mkdir(quarantineDir, { recursive: true });

    // Test connection to ClamAV
    const connected = await testConnection();
    
    if (connected) {
      logger.info(`[clamav] Connected to ClamAV at ${host}:${port}`);
    } else {
      logger.warn('[clamav] Failed to connect to ClamAV, virus scanning disabled');
      enabled = false;
    }
  } catch (error) {
    logger.error('[clamav] Failed to initialize:', error);
    enabled = false;
  }
}

/**
 * Test connection to ClamAV daemon
 */
function testConnection() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port }, () => {
      socket.write('PING');
    });

    socket.on('data', (data) => {
      if (data.toString().includes('PONG')) {
        socket.destroy();
        resolve(true);
      }
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Scan file
 */
async function scanFile(filePath) {
  if (!enabled) {
    logger.warn('[clamav] Virus scanning disabled');
    return { clean: true, reason: 'Scanning disabled' };
  }

  // Check cache
  const cacheKey = `file:${filePath}:${await getFileHash(filePath)}`;
  const cached = scanCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.debug(`[clamav] Cache hit for file: ${filePath}`);
    return cached.result;
  }

  try {
    const result = await scanViaClamAV(filePath);
    
    // Cache result
    scanCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    return result;
  } catch (error) {
    logger.error(`[clamav] Failed to scan file ${filePath}:`, error);
    return { clean: false, error: error.message };
  }
}

/**
 * Scan buffer
 */
async function scanBuffer(buffer, filename = 'unknown') {
  if (!enabled) {
    logger.warn('[clamav] Virus scanning disabled');
    return { clean: true, reason: 'Scanning disabled' };
  }

  try {
    const result = await scanBufferViaClamAV(buffer);
    return result;
  } catch (error) {
    logger.error(`[clamav] Failed to scan buffer:`, error);
    return { clean: false, error: error.message };
  }
}

/**
 * Scan file via ClamAV daemon
 */
function scanViaClamAV(filePath) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    socket.on('connect', () => {
      // Send SCAN command
      socket.write(`SCAN ${filePath}\n`);
    });

    let response = '';

    socket.on('data', (data) => {
      response += data.toString();
      
      // ClamAV sends response followed by newline
      if (response.includes('\n')) {
        socket.destroy();
        
        // Parse response
        // Format: /path/to/file: OK or /path/to/file: FOUND virus_name
        const lines = response.trim().split('\n');
        const results = lines.map(line => {
          const parts = line.split(': ');
          if (parts.length < 2) return null;
          
          const [file, status] = parts;
          const clean = status === 'OK';
          const virus = clean ? null : status.replace('FOUND ', '');

          return { file, clean, virus };
        }).filter(r => r !== null);

        const hasVirus = results.some(r => !r.clean);
        
        if (hasVirus) {
          const infected = results.filter(r => !r.clean);
          alertCritical('Virus detected', {
            file: filePath,
            viruses: infected.map(r => r.virus)
          });
          prom.alertsFailedTotal.inc({ channel: 'clamav' });
        } else {
          prom.alertsSentTotal.inc({ channel: 'clamav', severity: 'info' });
        }

        resolve({
          clean: !hasVirus,
          results,
          viruses: hasVirus ? infected.map(r => r.virus) : []
        });
      }
    });

    socket.on('error', (error) => {
      socket.destroy();
      reject(error);
    });

    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('Scan timeout'));
    });
  });
}

/**
 * Scan buffer via ClamAV daemon (INSTREAM)
 */
function scanBufferViaClamAV(buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });

    socket.on('connect', () => {
      // Send INSTREAM command
      socket.write('zINSTREAM\0');
      
      // Send data in chunks (ClamAV max chunk size is 64KB)
      const chunkSize = 64000;
      for (let i = 0; i < buffer.length; i += chunkSize) {
        const chunk = buffer.slice(i, i + chunkSize);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length, 0);
        socket.write(size);
        socket.write(chunk);
      }
      
      // Send zero-length chunk to end stream
      const endChunk = Buffer.alloc(4);
      socket.write(endChunk);
    });

    let response = '';

    socket.on('data', (data) => {
      response += data.toString();
      
      if (response.includes('\n')) {
        socket.destroy();
        
        // Parse response
        const lines = response.trim().split('\n');
        const results = lines.map(line => {
          const parts = line.split(': ');
          if (parts.length < 2) return null;
          
          const [file, status] = parts;
          const clean = status === 'OK';
          const virus = clean ? null : status.replace('FOUND ', '');

          return { file, clean, virus };
        }).filter(r => r !== null);

        const hasVirus = results.some(r => !r.clean);
        
        if (hasVirus) {
          const infected = results.filter(r => !r.clean);
          alertCritical('Virus detected in buffer', {
            viruses: infected.map(r => r.virus)
          });
          prom.alertsFailedTotal.inc({ channel: 'clamav' });
        } else {
          prom.alertsSentTotal.inc({ channel: 'clamav', severity: 'info' });
        }

        resolve({
          clean: !hasVirus,
          results,
          viruses: hasVirus ? infected.map(r => r.virus) : []
        });
      }
    });

    socket.on('error', (error) => {
      socket.destroy();
      reject(error);
    });

    socket.setTimeout(30000, () => {
      socket.destroy();
      reject(new Error('Scan timeout'));
    });
  });
}

/**
 * Get file hash for caching
 */
async function getFileHash(filePath) {
  try {
    const crypto = require('crypto');
    const content = await fs.readFile(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Quarantine infected file
 */
async function quarantineFile(filePath, virusName) {
  try {
    const filename = path.basename(filePath);
    const quarantinePath = path.join(quarantineDir, `${filename}_${Date.now()}.quarantine`);
    
    await fs.rename(filePath, quarantinePath);
    
    logger.info(`[clamav] Quarantined file: ${filePath} -> ${quarantinePath}`);
    
    return {
      success: true,
      quarantinePath,
      virusName
    };
  } catch (error) {
    logger.error('[clamav] Failed to quarantine file:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete quarantined file
 */
async function deleteQuarantinedFile(quarantinePath) {
  try {
    await fs.unlink(quarantinePath);
    logger.info(`[clamav] Deleted quarantined file: ${quarantinePath}`);
    return { success: true };
  } catch (error) {
    logger.error('[clamav] Failed to delete quarantined file:', error);
    return { success: false, error: error.message };
  }
}

/**
 * List quarantined files
 */
async function listQuarantinedFiles() {
  try {
    const files = await fs.readdir(quarantineDir);
    const quarantinedFiles = [];

    for (const file of files) {
      const filePath = path.join(quarantineDir, file);
      const stats = await fs.stat(filePath);
      quarantinedFiles.push({
        filename: file,
        path: filePath,
        size: stats.size,
        createdAt: stats.birthtime
      });
    }

    return quarantinedFiles;
  } catch (error) {
    logger.error('[clamav] Failed to list quarantined files:', error);
    return [];
  }
}

/**
 * Clean old quarantined files
 */
async function cleanQuarantine(daysToKeep = 30) {
  try {
    const files = await listQuarantinedFiles();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let deletedCount = 0;

    for (const file of files) {
      if (file.createdAt < cutoffDate) {
        await deleteQuarantinedFile(file.path);
        deletedCount++;
      }
    }

    logger.info(`[clamav] Cleaned ${deletedCount} old quarantined files`);
    return deletedCount;
  } catch (error) {
    logger.error('[clamav] Failed to clean quarantine:', error);
    return 0;
  }
}

/**
 * Get scan statistics
 */
function getStats() {
  return {
    enabled,
    host,
    port,
    quarantineDir,
    cacheSize: scanCache.size
  };
}

/**
 * Clear scan cache
 */
function clearCache() {
  scanCache.clear();
  logger.info('[clamav] Cleared scan cache');
}

/**
 * Middleware for file upload scanning
 */
function scanUploadMiddleware(options = {}) {
  const { fieldName = 'file', required = true } = options;

  return async (req, res, next) => {
    if (!enabled) {
      return next();
    }

    if (!req.file && required) {
      return res.status(400).json({
        success: false,
        error:({
          code: 'VAL_001',
          message: 'File upload required',
          statusCode: 400
        })
      });
    }

    if (req.file) {
      try {
        const result = await scanFile(req.file.path);
        
        if (!result.clean) {
          // Quarantine infected file
          await quarantineFile(req.file.path, result.viruses[0]);
          
          return res.status(400).json({
            success: false,
            error:({
              code: 'SEC_001',
              message: 'File contains virus',
              statusCode: 400,
              details: { viruses: result.viruses }
            })
          });
        }
      } catch (error) {
        logger.error('[clamav] Upload scan failed:', error);
        return res.status(500).json({
          success: false,
          error:({
            code: 'INT_001',
            message: 'Virus scan failed',
            statusCode: 500
          })
        });
      }
    }

    next();
  };
}

/**
 * Scan directory recursively
 */
async function scanDirectory(dirPath, options = {}) {
  const { maxDepth = 5, currentDepth = 0 } = options;

  if (currentDepth >= maxDepth) {
    return [];
  }

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        const subResults = await scanDirectory(fullPath, {
          maxDepth,
          currentDepth: currentDepth + 1
        });
        results.push(...subResults);
      } else if (entry.isFile()) {
        const result = await scanFile(fullPath);
        results.push({
          path: fullPath,
          ...result
        });
      }
    }

    return results;
  } catch (error) {
    logger.error(`[clamav] Failed to scan directory ${dirPath}:`, error);
    return [];
  }
}

module.exports = {
  initialize,
  scanFile,
  scanBuffer,
  quarantineFile,
  deleteQuarantinedFile,
  listQuarantinedFiles,
  cleanQuarantine,
  getStats,
  clearCache,
  scanUploadMiddleware,
  scanDirectory,
  testConnection,
  isEnabled: () => enabled
};
