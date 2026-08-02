/**
 * Backup Controller
 * 
 * Handles backup metadata management including:
 * - Creating backup records
 * - Tracking backup status
 * - Managing backup retention
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

/**
 * Create a backup metadata record
 */
async function createBackup(req, res) {
  try {
    const { backupType, backupMethod, fileName, fileSize, filePath, checksum, retentionDays, createdBy, notes } = req.body;

    const backup = await prisma.backupMetadata.create({
      data: {
        backupType,
        backupMethod,
        fileName,
        fileSize: BigInt(fileSize || 0),
        filePath,
        checksum,
        status: 'PENDING',
        startedAt: new Date(),
        retentionDays: retentionDays || 30,
        createdBy,
        notes
      }
    });

    logger.info(`Backup metadata created: ${backup.id} type ${backupType}`);

    res.status(201).json({
      success: true,
      data: backup
    });
  } catch (error) {
    logger.error('Failed to create backup metadata:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to create backup metadata',
        statusCode: 500
      })
    });
  }
}

/**
 * Update backup status
 */
async function updateBackupStatus(req, res) {
  try {
    const { id } = req.params;
    const { status, fileSize, checksum, completedAt } = req.body;

    const backup = await prisma.backupMetadata.findUnique({
      where: { id }
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Backup not found',
          statusCode: 404
        })
      });
    }

    const updateData = { status };
    if (fileSize !== undefined) updateData.fileSize = BigInt(fileSize);
    if (checksum !== undefined) updateData.checksum = checksum;
    if (status === 'COMPLETED') updateData.completedAt = completedAt ? new Date(completedAt) : new Date();

    const updated = await prisma.backupMetadata.update({
      where: { id },
      data: updateData
    });

    logger.info(`Backup ${id} status updated to ${status}`);

    res.json({
      success: true,
      data: updated
    });
  } catch (error) {
    logger.error('Failed to update backup status:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to update backup status',
        statusCode: 500
      })
    });
  }
}

/**
 * Get backups for a school
 */
async function getBackups(req, res) {
  try {
    const { backupType, backupMethod, status } = req.query;

    const where = {};
    if (backupType) where.backupType = backupType;
    if (backupMethod) where.backupMethod = backupMethod;
    if (status) where.status = status;

    const backups = await prisma.backupMetadata.findMany({
      where,
      orderBy: { startedAt: 'desc' }
    });

    // Convert BigInt to Number for JSON serialization
    const serializedBackups = backups.map(b => ({
      ...b,
      fileSize: b.fileSize ? Number(b.fileSize) : 0
    }));

    res.json({
      success: true,
      data: serializedBackups
    });
  } catch (error) {
    logger.error('Failed to get backups:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get backups',
        statusCode: 500
      })
    });
  }
}

/**
 * Get a specific backup
 */
async function getBackup(req, res) {
  try {
    const { id } = req.params;

    const backup = await prisma.backupMetadata.findUnique({
      where: { id }
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Backup not found',
          statusCode: 404
        })
      });
    }

    // Convert BigInt to Number for JSON serialization
    const serializedBackup = {
      ...backup,
      fileSize: backup.fileSize ? Number(backup.fileSize) : 0
    };

    res.json({
      success: true,
      data: serializedBackup
    });
  } catch (error) {
    logger.error('Failed to get backup:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get backup',
        statusCode: 500
      })
    });
  }
}

/**
 * Delete a backup record
 */
async function deleteBackup(req, res) {
  try {
    const { id } = req.params;

    const backup = await prisma.backupMetadata.findUnique({
      where: { id }
    });

    if (!backup) {
      return res.status(404).json({
        success: false,
        error:({
          code: 'NOT_FOUND_001',
          message: 'Backup not found',
          statusCode: 404
        })
      });
    }

    await prisma.backupMetadata.update({
      where: { id },
      data: { deletedAt: new Date() }
    });

    logger.info(`Backup ${id} deleted`);

    res.json({
      success: true,
      message: 'Backup deleted successfully'
    });
  } catch (error) {
    logger.error('Failed to delete backup:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to delete backup',
        statusCode: 500
      })
    });
  }
}

/**
 * Get backup statistics
 */
async function getBackupStats(req, res) {
  try {
    const [total, byType, byMethod, byStatus, recent] = await Promise.all([
      prisma.backupMetadata.count({ where: { deletedAt: null } }),
      prisma.backupMetadata.groupBy({
        by: ['backupType'],
        where: { deletedAt: null },
        _count: true
      }),
      prisma.backupMetadata.groupBy({
        by: ['backupMethod'],
        where: { deletedAt: null },
        _count: true
      }),
      prisma.backupMetadata.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: true
      }),
      prisma.backupMetadata.findMany({
        where: { deletedAt: null },
        orderBy: { startedAt: 'desc' },
        take: 10
      })
    ]);

    // Calculate total storage
    const backups = await prisma.backupMetadata.findMany({
      where: { deletedAt: null },
      select: { fileSize: true }
    });

    const totalStorage = backups.reduce((sum, b) => sum + (b.fileSize ? Number(b.fileSize) : 0), 0);

    res.json({
      success: true,
      data: {
        total,
        byType,
        byMethod,
        byStatus,
        totalStorage,
        recent
      }
    });
  } catch (error) {
    logger.error('Failed to get backup stats:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to get backup stats',
        statusCode: 500
      })
    });
  }
}

/**
 * Prune old backups
 */
async function pruneOldBackups(req, res) {
  try {
    const { days = 30 } = req.body;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const deleted = await prisma.backupMetadata.updateMany({
      where: {
        completedAt: {
          lt: cutoffDate
        },
        deletedAt: null
      },
      data: {
        deletedAt: new Date()
      }
    });

    logger.info(`Pruned ${deleted.count} backups older than ${days} days`);

    res.json({
      success: true,
      data: {
        deletedCount: deleted.count
      }
    });
  } catch (error) {
    logger.error('Failed to prune old backups:', error);
    res.status(500).json({
      success: false,
      error:({
        code: 'INT_001',
        message: 'Failed to prune old backups',
        statusCode: 500
      })
    });
  }
}

module.exports = {
  createBackup,
  updateBackupStatus,
  getBackups,
  getBackup,
  deleteBackup,
  getBackupStats,
  pruneOldBackups
};
