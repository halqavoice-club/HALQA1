/**
 * SMS Service (Twilio)
 * 
 * Provides SMS messaging capabilities using Twilio API.
 * Supports:
 * - Send single SMS
 * - Bulk SMS sending
 * - SMS templates
 * - Delivery status tracking
 * - Rate limiting
 * - Opt-out management
 * 
 * Usage:
 *   const sms = require('./utils/sms');
 *   
 *   // Send SMS
 *   await sms.send('+1234567890', 'Your verification code is 123456');
 *   
 *   // Send with template
 *   await sms.sendTemplate('+1234567890', 'verification', { code: '123456' });
 * 
 * Environment Variables:
 *   TWILIO_ACCOUNT_SID: Twilio account SID
 *   TWILIO_AUTH_TOKEN: Twilio auth token
 *   TWILIO_PHONE_NUMBER: Twilio phone number
 *   SMS_ENABLED: true/false (default: true)
 */

const twilio = require('twilio');
const logger = require('./logger');
const { alertCritical } = require('./alerting');
const prom = require('./prometheus');

let client = null;
let enabled = process.env.SMS_ENABLED !== 'false';

// SMS templates
const templates = {
  verification: (data) => `Your verification code is ${data.code}. Valid for 10 minutes.`,
  otp: (data) => `Your OTP is ${data.code}. Do not share with anyone.`,
  alert: (data) => `Alert: ${data.message}`,
  reminder: (data) => `Reminder: ${data.message}`,
  welcome: (data) => `Welcome to Halqa! Your account has been created successfully.`,
  passwordReset: (data) => `Your password reset code is ${data.code}. Valid for 15 minutes.`
};

/**
 * Initialize Twilio client
 */
function initialize() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    logger.warn('[sms] Twilio credentials not configured, SMS disabled');
    enabled = false;
    return;
  }

  try {
    client = twilio(accountSid, authToken);
    logger.info('[sms] Twilio client initialized');
  } catch (error) {
    logger.error('[sms] Failed to initialize Twilio client:', error);
    enabled = false;
  }
}

/**
 * Send SMS
 */
async function send(to, body, options = {}) {
  if (!enabled || !client) {
    logger.warn('[sms] SMS disabled or client not initialized');
    return { success: false, reason: 'SMS disabled' };
  }

  const from = options.from || process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    logger.error('[sms] Twilio phone number not configured');
    return { success: false, reason: 'Phone number not configured' };
  }

  try {
    const message = await client.messages.create({
      body,
      from,
      to
    });

    logger.info(`[sms] SMS sent to ${to}, SID: ${message.sid}`);
    prom.alertsSentTotal.inc({ channel: 'sms', severity: 'info' });

    return {
      success: true,
      sid: message.sid,
      status: message.status,
      to,
      from
    };
  } catch (error) {
    logger.error(`[sms] Failed to send SMS to ${to}:`, error);
    prom.alertsFailedTotal.inc({ channel: 'sms' });

    // Alert on critical failures
    if (error.status >= 500) {
      alertCritical('SMS service error', {
        error: error.message,
        to,
        status: error.status
      });
    }

    return {
      success: false,
      reason: error.message,
      code: error.code
    };
  }
}

/**
 * Send SMS using template
 */
async function sendTemplate(to, templateName, data = {}, options = {}) {
  const template = templates[templateName];
  if (!template) {
    logger.error(`[sms] Template not found: ${templateName}`);
    return { success: false, reason: 'Template not found' };
  }

  const body = template(data);
  return await send(to, body, options);
}

/**
 * Send bulk SMS
 */
async function sendBulk(recipients, body, options = {}) {
  const { delay = 1000, maxConcurrent = 10 } = options;
  const results = {
    total: recipients.length,
    succeeded: 0,
    failed: 0,
    errors: []
  };

  // Process in batches to avoid rate limiting
  for (let i = 0; i < recipients.length; i += maxConcurrent) {
    const batch = recipients.slice(i, i + maxConcurrent);
    const promises = batch.map(recipient => 
      send(recipient, body, options)
        .then(result => {
          if (result.success) {
            results.succeeded++;
          } else {
            results.failed++;
            results.errors.push({ recipient, error: result.reason });
          }
        })
        .catch(error => {
          results.failed++;
          results.errors.push({ recipient, error: error.message });
        })
    );

    await Promise.all(promises);

    // Delay between batches
    if (i + maxConcurrent < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  logger.info(`[sms] Bulk SMS completed: ${results.succeeded}/${results.total} succeeded`);
  return results;
}

/**
 * Get message status
 */
async function getStatus(messageSid) {
  if (!enabled || !client) {
    return { status: 'disabled' };
  }

  try {
    const message = await client.messages(messageSid).fetch();
    return {
      sid: message.sid,
      status: message.status,
      to: message.to,
      from: message.from,
      dateCreated: message.dateCreated,
      dateUpdated: message.dateUpdated,
      errorCode: message.errorCode,
      errorMessage: message.errorMessage
    };
  } catch (error) {
    logger.error(`[sms] Failed to get message status:`, error);
    return { error: error.message };
  }
}

/**
 * Register custom template
 */
function registerTemplate(name, templateFn) {
  templates[name] = templateFn;
  logger.info(`[sms] Registered template: ${name}`);
}

/**
 * Check if phone number is valid
 */
function isValidPhoneNumber(phoneNumber) {
  // Basic validation for E.164 format
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  return phoneRegex.test(phoneNumber);
}

/**
 * Format phone number to E.164
 */
function formatPhoneNumber(phoneNumber) {
  // Remove all non-numeric characters
  let cleaned = phoneNumber.replace(/\D/g, '');
  
  // Add + prefix if not present
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  return cleaned;
}

/**
 * Check if number is opted out
 */
async function isOptedOut(phoneNumber) {
  if (!enabled || !client) {
    return false;
  }

  try {
    const service = client.messaging.services(process.env.TWILIO_MESSAGING_SERVICE_SID);
    if (!service) {
      return false;
    }

    const phoneNumberObj = await service.phoneNumbers(phoneNumber).fetch();
    return phoneNumberObj.capabilities?.sms === false;
  } catch (error) {
    logger.error('[sms] Failed to check opt-out status:', error);
    return false;
  }
}

/**
 * Add number to opt-out list
 */
async function optOut(phoneNumber) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    await client.messaging.v1.services(process.env.TWILIO_MESSAGING_SERVICE_SID)
      .phoneNumbers(phoneNumber)
      .update({ capabilities: { sms: false } });

    logger.info(`[sms] Added ${phoneNumber} to opt-out list`);
    return { success: true };
  } catch (error) {
    logger.error('[sms] Failed to opt-out number:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove number from opt-out list
 */
async function optIn(phoneNumber) {
  if (!enabled || !client) {
    return { success: false };
  }

  try {
    await client.messaging.v1.services(process.env.TWILIO_MESSAGING_SERVICE_SID)
      .phoneNumbers(phoneNumber)
      .update({ capabilities: { sms: true } });

    logger.info(`[sms] Removed ${phoneNumber} from opt-out list`);
    return { success: true };
  } catch (error) {
    logger.error('[sms] Failed to opt-in number:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get SMS usage statistics
 */
async function getUsageStats(startDate, endDate) {
  if (!enabled || !client) {
    return { status: 'disabled' };
  }

  try {
    const records = await client.usage.records.each({
      category: 'sms',
      startDate,
      endDate
    });

    let totalMessages = 0;
    let totalCost = 0;

    for await (const record of records) {
      totalMessages += record.count || 0;
      totalCost += parseFloat(record.price || 0);
    }

    return {
      totalMessages,
      totalCost,
      currency: 'USD',
      startDate,
      endDate
    };
  } catch (error) {
    logger.error('[sms] Failed to get usage stats:', error);
    return { error: error.message };
  }
}

/**
 * Send verification code
 */
async function sendVerificationCode(phoneNumber, code) {
  return await sendTemplate(phoneNumber, 'verification', { code });
}

/**
 * Send OTP
 */
async function sendOTP(phoneNumber, code) {
  return await sendTemplate(phoneNumber, 'otp', { code });
}

/**
 * Send password reset code
 */
async function sendPasswordResetCode(phoneNumber, code) {
  return await sendTemplate(phoneNumber, 'passwordReset', { code });
}

/**
 * Pre-configured SMS strategies
 */

const verificationSMS = {
  template: 'verification',
  ttl: 600000 // 10 minutes
};

const alertSMS = {
  template: 'alert',
  priority: 'high'
};

const bulkSMS = {
  delay: 1000,
  maxConcurrent: 10
};

module.exports = {
  initialize,
  send,
  sendTemplate,
  sendBulk,
  getStatus,
  registerTemplate,
  isValidPhoneNumber,
  formatPhoneNumber,
  isOptedOut,
  optOut,
  optIn,
  getUsageStats,
  sendVerificationCode,
  sendOTP,
  sendPasswordReset,
  templates,
  verificationSMS,
  alertSMS,
  bulkSMS,
  isEnabled: () => enabled
};
