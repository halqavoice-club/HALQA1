/**
 * Webhook System
 * 
 * Provides webhook management for event-driven integrations.
 * Supports:
 * - Webhook registration and management
 * - Event-based webhook triggering
 * - Retry logic with exponential backoff
 * - Signature verification (HMAC)
 * - Webhook delivery history
 * - Webhook statistics
 * 
 * Usage:
 *   const webhook = require('./utils/webhook');
 *   
 *   // Register webhook
 *   await webhook.register({
 *     url: 'https://example.com/webhook',
 *     events: ['user.created', 'user.updated'],
 *     secret: 'webhook-secret'
 *   });
 *   
 *   // Trigger event
 *   await webhook.trigger('user.created', { userId: '123', name: 'John' });
 */

const crypto = require('crypto');
const prisma = require('./prisma');
const logger = require('./logger');
const { alertCritical } = require('./alerting');
const prom = require('./prometheus');

// In-memory webhook cache (for performance)
const webhookCache = new Map();
const CACHE_TTL = 300000; // 5 minutes

/**
 * Register a new webhook
 */
async function register(options) {
  const {
    url,
    events,
    secret,
    headers = {},
    description,
    userId,
    schoolId
  } = options;

  try {
    const webhook = await prisma.webhook.create({
      data: {
        url,
        events,
        secret,
        headers,
        description,
        userId,
        schoolId,
        isActive: true
      }
    });

    // Invalidate cache
    webhookCache.clear();

    logger.info(`[webhook] Registered webhook: ${webhook.id} for events:`, events);
    return webhook;
  } catch (error) {
    logger.error('[webhook] Failed to register webhook:', error);
    throw error;
  }
}

/**
 * Unregister a webhook
 */
async function unregister(webhookId) {
  try {
    await prisma.webhook.update({
      where: { id: webhookId },
      data: { isActive: false }
    });

    // Invalidate cache
    webhookCache.clear();

    logger.info(`[webhook] Unregistered webhook: ${webhookId}`);
  } catch (error) {
    logger.error('[webhook] Failed to unregister webhook:', error);
    throw error;
  }
}

/**
 * Update webhook
 */
async function update(webhookId, options) {
  try {
    const webhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: options
    });

    // Invalidate cache
    webhookCache.clear();

    logger.info(`[webhook] Updated webhook: ${webhookId}`);
    return webhook;
  } catch (error) {
    logger.error('[webhook] Failed to update webhook:', error);
    throw error;
  }
}

/**
 * Get webhooks for an event
 */
async function getWebhooksForEvent(event) {
  const cacheKey = `webhooks:${event}`;
  
  // Check cache first
  if (webhookCache.has(cacheKey)) {
    const cached = webhookCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.webhooks;
    }
  }

  try {
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: {
          has: event
        }
      }
    });

    // Cache result
    webhookCache.set(cacheKey, {
      webhooks,
      timestamp: Date.now()
    });

    return webhooks;
  } catch (error) {
    logger.error('[webhook] Failed to get webhooks for event:', error);
    return [];
  }
}

/**
 * Trigger webhooks for an event
 */
async function trigger(event, payload, options = {}) {
  const { synchronous = false, retryCount = 3 } = options;

  const webhooks = await getWebhooksForEvent(event);
  
  if (webhooks.length === 0) {
    logger.debug(`[webhook] No webhooks registered for event: ${event}`);
    return { triggered: 0, succeeded: 0, failed: 0 };
  }

  logger.info(`[webhook] Triggering ${webhooks.length} webhooks for event: ${event}`);

  const results = {
    triggered: webhooks.length,
    succeeded: 0,
    failed: 0,
    errors: []
  };

  const promises = webhooks.map(webhook => 
    deliverWebhook(webhook, event, payload, retryCount)
  );

  if (synchronous) {
    const deliveries = await Promise.allSettled(promises);
    
    deliveries.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        results.succeeded++;
      } else {
        results.failed++;
        results.errors.push({
          webhookId: webhooks[index].id,
          error: result.reason.message
        });
      }
    });
  } else {
    // Fire and forget
    promises.forEach(promise => {
      promise
        .then(() => results.succeeded++)
        .catch(() => results.failed++);
    });
  }

  return results;
}

/**
 * Deliver webhook to a specific URL
 */
async function deliverWebhook(webhook, event, payload, retryCount = 3) {
  const deliveryId = crypto.randomUUID();
  let attempt = 0;
  let lastError = null;

  while (attempt <= retryCount) {
    try {
      const signature = generateSignature(webhook.secret, payload);
      const timestamp = Date.now();

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Delivery-ID': deliveryId,
          'X-Webhook-Timestamp': timestamp.toString(),
          'X-Webhook-Signature': signature,
          ...webhook.headers
        },
        body: JSON.stringify({
          event,
          payload,
          timestamp,
          deliveryId
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Log successful delivery
      await logDelivery(webhook.id, deliveryId, event, true, null, attempt + 1);
      prom.alertsSentTotal.inc({ channel: 'webhook', severity: 'info' });

      logger.info(`[webhook] Delivered webhook ${webhook.id} for event ${event}`);
      return { success: true, deliveryId };
    } catch (error) {
      lastError = error;
      attempt++;

      if (attempt <= retryCount) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`[webhook] Delivery attempt ${attempt}/${retryCount} failed for webhook ${webhook.id}, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  await logDelivery(webhook.id, deliveryId, event, false, lastError.message, attempt);
  prom.alertsFailedTotal.inc({ channel: 'webhook' });
  
  logger.error(`[webhook] Failed to deliver webhook ${webhook.id} after ${attempt} attempts:`, lastError.message);
  
  // Alert on critical failures
  if (attempt >= retryCount) {
    alertCritical('Webhook delivery failed', {
      webhookId: webhook.id,
      event,
      attempts: attempt,
      error: lastError.message
    });
  }

  throw lastError;
}

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(secret, payload) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify webhook signature
 */
function verifySignature(secret, payload, signature) {
  const expectedSignature = generateSignature(secret, payload);
  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

/**
 * Log webhook delivery
 */
async function logDelivery(webhookId, deliveryId, event, success, error, attempt) {
  try {
    await prisma.webhookDelivery.create({
      data: {
        webhookId,
        deliveryId,
        event,
        success,
        error,
        attempt,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('[webhook] Failed to log delivery:', error);
  }
}

/**
 * Get webhook delivery history
 */
async function getDeliveryHistory(webhookId, options = {}) {
  const { limit = 50, offset = 0, event } = options;

  try {
    const where = { webhookId };
    if (event) {
      where.event = event;
    }

    const deliveries = await prisma.webhookDelivery.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset
    });

    return deliveries;
  } catch (error) {
    logger.error('[webhook] Failed to get delivery history:', error);
    return [];
  }
}

/**
 * Get webhook statistics
 */
async function getStats(webhookId = null) {
  try {
    const where = webhookId ? { id: webhookId } : {};

    const [total, active, inactive, deliveries] = await Promise.all([
      prisma.webhook.count({ where }),
      prisma.webhook.count({ where: { ...where, isActive: true } }),
      prisma.webhook.count({ where: { ...where, isActive: false } }),
      prisma.webhookDelivery.count()
    ]);

    const successfulDeliveries = await prisma.webhookDelivery.count({
      where: { success: true }
    });

    const failedDeliveries = await prisma.webhookDelivery.count({
      where: { success: false }
    });

    return {
      total,
      active,
      inactive,
      deliveries,
      successfulDeliveries,
      failedDeliveries,
      successRate: deliveries > 0 ? (successfulDeliveries / deliveries * 100).toFixed(2) + '%' : '0%'
    };
  } catch (error) {
    logger.error('[webhook] Failed to get stats:', error);
    return null;
  }
}

/**
 * Test webhook delivery
 */
async function test(webhookId, event = 'test.event', payload = { test: true }) {
  try {
    const webhook = await prisma.webhook.findUnique({
      where: { id: webhookId }
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const result = await deliverWebhook(webhook, event, payload, 1);
    return result;
  } catch (error) {
    logger.error('[webhook] Test failed:', error);
    throw error;
  }
}

/**
 * Replay failed webhook delivery
 */
async function replay(deliveryId) {
  try {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true }
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    if (delivery.success) {
      throw new Error('Delivery was successful, cannot replay');
    }

    const result = await deliverWebhook(delivery.webhook, delivery.event, {}, 3);
    return result;
  } catch (error) {
    logger.error('[webhook] Replay failed:', error);
    throw error;
  }
}

/**
 * Delete webhook
 */
async function deleteWebhook(webhookId) {
  try {
    await prisma.webhook.delete({
      where: { id: webhookId }
    });

    // Invalidate cache
    webhookCache.clear();

    logger.info(`[webhook] Deleted webhook: ${webhookId}`);
  } catch (error) {
    logger.error('[webhook] Failed to delete webhook:', error);
    throw error;
  }
}

/**
 * Express middleware for webhook signature verification
 */
function verificationMiddleware(secret) {
  return (req, res, next) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];

    if (!signature) {
      return res.status(401).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Missing signature',
          statusCode: 401
        })
      });
    }

    // Check timestamp (prevent replay attacks, 5 minute window)
    if (timestamp) {
      const now = Date.now();
      const timestampNum = parseInt(timestamp, 10);
      if (now - timestampNum > 300000) {
        return res.status(401).json({
          success: false,
          error:({
            code: 'AUTH_001',
            message: 'Timestamp too old',
            statusCode: 401
          })
        });
      }
    }

    // Verify signature
    const isValid = verifySignature(secret, req.body, signature);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        error:({
          code: 'AUTH_001',
          message: 'Invalid signature',
          statusCode: 401
        })
      });
    }

    next();
  };
}

/**
 * Prune old delivery logs
 */
async function pruneDeliveries(daysToKeep = 30) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await prisma.webhookDelivery.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        }
      }
    });

    logger.info(`[webhook] Pruned ${result.count} old delivery logs`);
    return result.count;
  } catch (error) {
    logger.error('[webhook] Failed to prune deliveries:', error);
    return 0;
  }
}

module.exports = {
  register,
  unregister,
  update,
  getWebhooksForEvent,
  trigger,
  deliverWebhook,
  generateSignature,
  verifySignature,
  logDelivery,
  getDeliveryHistory,
  getStats,
  test,
  replay,
  deleteWebhook,
  verificationMiddleware,
  pruneDeliveries
};
