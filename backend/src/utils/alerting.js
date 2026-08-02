/**
 * Alerting System
 * 
 * Sends alerts to various channels (Slack, PagerDuty, email) based on system events.
 * 
 * Supported channels:
 * - Slack webhooks
 * - PagerDuty events API
 * - Email notifications
 * - Custom webhooks
 * 
 * Usage:
 *   const alerting = require('./utils/alerting');
 *   await alerting.send('slack', { message: 'Alert text' });
 *   await alerting.alert('critical', 'Service down', { details: {...} });
 */

const logger = require('./logger');
const prom = require('./prometheus');

/**
 * Send alert to Slack
 */
async function sendSlackAlert(options) {
  const { webhookUrl, message, channel, username, iconEmoji, attachments } = options;

  if (!webhookUrl || !process.env.SLACK_WEBHOOK_URL) {
    logger.warn('[alerting] Slack webhook URL not configured');
    return;
  }

  const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: message,
        channel: channel || process.env.SLACK_CHANNEL || '#alerts',
        username: username || 'Halqa Alerts',
        icon_emoji: iconEmoji || ':warning:',
        attachments: attachments || []
      })
    });

    if (!response.ok) {
      throw new Error(`Slack API returned ${response.status}`);
    }

    logger.info('[alerting] Slack alert sent successfully');
    prom.alertsSentTotal.inc({ channel: 'slack', severity: options.severity || 'info' });
  } catch (error) {
    logger.error('[alerting] Failed to send Slack alert:', error);
    prom.alertsFailedTotal.inc({ channel: 'slack' });
  }
}

/**
 * Send alert to PagerDuty
 */
async function sendPagerDutyAlert(options) {
  const { routingKey, eventAction, dedupKey, payload } = options;

  if (!routingKey && !process.env.PAGERDUTY_ROUTING_KEY) {
    logger.warn('[alerting] PagerDuty routing key not configured');
    return;
  }

  const key = routingKey || process.env.PAGERDUTY_ROUTING_KEY;
  const url = process.env.PAGERDUTY_EVENTS_API_URL || 'https://events.pagerduty.com/v2/enqueue';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: key,
        event_action: eventAction || 'trigger',
        dedup_key: dedupKey,
        payload: {
          summary: payload?.summary || 'Alert from Halqa Backend',
          severity: payload?.severity || 'critical',
          source: payload?.source || 'halqa-backend',
          timestamp: new Date().toISOString(),
          custom_details: payload?.details || {}
        }
      })
    });

    if (!response.ok) {
      throw new Error(`PagerDuty API returned ${response.status}`);
    }

    logger.info('[alerting] PagerDuty alert sent successfully');
    prom.alertsSentTotal.inc({ channel: 'pagerduty', severity: payload?.severity || 'critical' });
  } catch (error) {
    logger.error('[alerting] Failed to send PagerDuty alert:', error);
    prom.alertsFailedTotal.inc({ channel: 'pagerduty' });
  }
}

/**
 * Send alert via email
 */
async function sendEmailAlert(options) {
  const { to, subject, body, isHtml } = options;

  try {
    const { sendEmail } = require('./email');
    await sendEmail(to, subject, body, isHtml);
    logger.info('[alerting] Email alert sent successfully');
    prom.alertsSentTotal.inc({ channel: 'email', severity: options.severity || 'info' });
  } catch (error) {
    logger.error('[alerting] Failed to send email alert:', error);
    prom.alertsFailedTotal.inc({ channel: 'email' });
  }
}

/**
 * Send alert to custom webhook
 */
async function sendWebhookAlert(options) {
  const { url, data, headers = {} } = options;

  if (!url) {
    logger.warn('[alerting] Webhook URL not provided');
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'halqa-backend',
        environment: process.env.NODE_ENV,
        ...data
      })
    });

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`);
    }

    logger.info('[alerting] Webhook alert sent successfully');
    prom.alertsSentTotal.inc({ channel: 'webhook', severity: options.severity || 'info' });
  } catch (error) {
    logger.error('[alerting] Failed to send webhook alert:', error);
    prom.alertsFailedTotal.inc({ channel: 'webhook' });
  }
}

/**
 * Send alert based on severity level
 * 
 * Routes alerts to appropriate channels based on severity.
 */
async function alert(severity, message, options = {}) {
  const { details, channels, dedupKey } = options;

  const alertData = {
    severity,
    message,
    details,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    hostname: require('os').hostname()
  };

  // Determine which channels to use
  const targetChannels = channels || getDefaultChannels(severity);

  // Send to each configured channel
  const promises = [];

  if (targetChannels.includes('slack')) {
    promises.push(sendSlackAlert({
      message: `[${severity.toUpperCase()}] ${message}`,
      attachments: details ? [{
        color: getSeverityColor(severity),
        fields: Object.entries(details).map(([key, value]) => ({
          title: key,
          value: String(value),
          short: true
        }))
      }] : undefined
    }));
  }

  if (targetChannels.includes('pagerduty') && severity === 'critical') {
    promises.push(sendPagerDutyAlert({
      eventAction: 'trigger',
      dedupKey: dedupKey || `${severity}:${message}`,
      payload: {
        summary: message,
        severity,
        source: 'halqa-backend',
        details
      }
    }));
  }

  if (targetChannels.includes('email')) {
    const emailBody = formatEmailBody(alertData);
    promises.push(sendEmailAlert({
      to: process.env.ALERT_EMAIL_TO || process.env.ADMIN_EMAIL,
      subject: `[${severity.toUpperCase()}] ${message}`,
      body: emailBody,
      isHtml: true
    }));
  }

  if (targetChannels.includes('webhook') && process.env.ALERT_WEBHOOK_URL) {
    promises.push(sendWebhookAlert({
      url: process.env.ALERT_WEBHOOK_URL,
      data: alertData
    }));
  }

  await Promise.allSettled(promises);
}

/**
 * Get default channels for severity level
 */
function getDefaultChannels(severity) {
  switch (severity) {
    case 'critical':
      return ['slack', 'pagerduty', 'email'];
    case 'warning':
      return ['slack', 'email'];
    case 'info':
      return ['slack'];
    default:
      return [];
  }
}

/**
 * Get color for Slack attachment based on severity
 */
function getSeverityColor(severity) {
  switch (severity) {
    case 'critical':
      return '#FF0000';
    case 'warning':
      return '#FFA500';
    case 'info':
      return '#36A64F';
    default:
      return '#808080';
  }
}

/**
 * Format alert as HTML email body
 */
function formatEmailBody(alertData) {
  return `
    <h2>Halqa Backend Alert</h2>
    <p><strong>Severity:</strong> ${alertData.severity.toUpperCase()}</p>
    <p><strong>Message:</strong> ${alertData.message}</p>
    <p><strong>Environment:</strong> ${alertData.environment}</p>
    <p><strong>Hostname:</strong> ${alertData.hostname}</p>
    <p><strong>Timestamp:</strong> ${alertData.timestamp}</p>
    ${alertData.details ? `
      <h3>Details</h3>
      <table border="1" cellpadding="5">
        ${Object.entries(alertData.details).map(([key, value]) => `
          <tr>
            <td><strong>${key}</strong></td>
            <td>${value}</td>
          </tr>
        `).join('')}
      </table>
    ` : ''}
  `;
}

/**
 * Pre-configured alert helpers
 */

async function alertCritical(message, details) {
  return alert('critical', message, { details });
}

async function alertWarning(message, details) {
  return alert('warning', message, { details });
}

async function alertInfo(message, details) {
  return alert('info', message, { details });
}

/**
 * Circuit breaker state change alert
 */
async function alertCircuitBreaker(service, state, details) {
  const severity = state === 'OPEN' ? 'critical' : 'warning';
  return alert(severity, `Circuit breaker ${state} for ${service}`, {
    details: {
      service,
      state,
      ...details
    }
  });
}

/**
 * Health check failure alert
 */
async function alertHealthCheck(checkName, status, details) {
  const severity = status === 'error' ? 'critical' : 'warning';
  return alert(severity, `Health check failed: ${checkName}`, {
    details: {
      check: checkName,
      status,
      ...details
    }
  });
}

/**
 * Rate limit exceeded alert
 */
async function alertRateLimitExceeded(userId, endpoint, details) {
  return alert('warning', `Rate limit exceeded for user ${userId}`, {
    details: {
      userId,
      endpoint,
      ...details
    }
  });
}

/**
 * Error spike alert
 */
async function alertErrorSpike(errorCount, threshold, window) {
  return alert('critical', `Error spike detected: ${errorCount} errors in ${window}ms`, {
    details: {
      errorCount,
      threshold,
      window
    }
  });
}

module.exports = {
  sendSlackAlert,
  sendPagerDutyAlert,
  sendEmailAlert,
  sendWebhookAlert,
  alert,
  alertCritical,
  alertWarning,
  alertInfo,
  alertCircuitBreaker,
  alertHealthCheck,
  alertRateLimitExceeded,
  alertErrorSpike
};
