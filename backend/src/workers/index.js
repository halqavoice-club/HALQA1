'use strict';
/**
 * Workers index — re-exports all worker factory functions.
 * Import from here to avoid long relative paths in queue.service.js.
 */
const { createEmailWorker         } = require('./email.worker');
const { createNotificationWorker  } = require('./notification.worker');
const { createReportWorker        } = require('./report.worker');
const { createCleanupWorker       } = require('./cleanup.worker');
const { createStorageWorker       } = require('./storage.worker');
const { createPostSchedulerWorker } = require('./post-scheduler.worker');
const { createRoomReminderWorker      } = require('./room-reminder.worker');
const { createLiveClassAutoEndWorker  } = require('./live-class-autoend.worker');

module.exports = {
  createEmailWorker,
  createNotificationWorker,
  createReportWorker,
  createCleanupWorker,
  createStorageWorker,
  createPostSchedulerWorker,
  createRoomReminderWorker,
  createLiveClassAutoEndWorker,
};
