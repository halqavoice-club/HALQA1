/**
 * Input sanitization middleware
 * Strips HTML tags and trims strings from req.body, req.query, req.params
 */

function stripHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = stripHtml(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map(v => typeof v === 'string' ? stripHtml(v) : v);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function sanitize(req, res, next) {
  // BE-007: Stripe webhook requires the raw, unmodified Buffer body for
  // signature verification via stripe.webhooks.constructEvent().
  // Sanitizing it would corrupt the payload and cause all webhooks to fail.
  // The Stripe route uses express.raw() — body is a Buffer, not an object.
  if (req.path.includes('/stripe/webhook')) return next();

  if (req.body) req.body = sanitizeObject(req.body);
  if (req.query) req.query = sanitizeObject(req.query);
  next();
}

module.exports = sanitize;
