/**
 * Email Template Engine (Handlebars)
 * 
 * Provides email template rendering using Handlebars.
 * Supports:
 * - Template registration and management
 * - Dynamic data binding
 * - Template inheritance/partials
 * - HTML and plain text rendering
 * - Template caching
 * - Pre-built common templates
 * 
 * Usage:
 *   const emailTemplates = require('./utils/emailTemplates');
 *   
 *   // Register template
 *   emailTemplates.register('welcome', 'Welcome {{name}}!');
 *   
 *   // Render template
 *   const html = emailTemplates.render('welcome', { name: 'John' });
 * 
 * Environment Variables:
 *   EMAIL_TEMPLATE_DIR: Directory for template files (default: ./templates)
 *   EMAIL_TEMPLATE_CACHE_ENABLED: true/false (default: true)
 */

const Handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

let templateCache = new Map();
let partialsCache = new Map();
let cacheEnabled = process.env.EMAIL_TEMPLATE_CACHE_ENABLED !== 'false';
const templateDir = process.env.EMAIL_TEMPLATE_DIR || path.join(__dirname, '../../templates');

/**
 * Initialize template engine
 */
async function initialize() {
  try {
    // Register built-in helpers
    registerHelpers();

    // Load templates from directory if it exists
    try {
      await fs.access(templateDir);
      await loadTemplatesFromDir(templateDir);
      logger.info(`[emailTemplates] Loaded templates from ${templateDir}`);
    } catch (error) {
      logger.debug(`[emailTemplates] Template directory not found: ${templateDir}`);
    }

    // Register built-in templates
    registerBuiltInTemplates();

    logger.info('[emailTemplates] Template engine initialized');
  } catch (error) {
    logger.error('[emailTemplates] Failed to initialize:', error);
  }
}

/**
 * Register Handlebars helpers
 */
function registerHelpers() {
  // Format date
  Handlebars.registerHelper('formatDate', function(date, format) {
    const d = new Date(date);
    if (format === 'short') {
      return d.toLocaleDateString();
    } else if (format === 'long') {
      return d.toLocaleString();
    }
    return d.toISOString();
  });

  // Format currency
  Handlebars.registerHelper('formatCurrency', function(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).format(amount);
  });

  // Conditional equals
  Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
  });

  // Conditional not equals
  Handlebars.registerHelper('ne', function(a, b) {
    return a !== b;
  });

  // Conditional greater than
  Handlebars.registerHelper('gt', function(a, b) {
    return a > b;
  });

  // Conditional less than
  Handlebars.registerHelper('lt', function(a, b) {
    return a < b;
  });

  // JSON stringify
  Handlebars.registerHelper('json', function(context) {
    return JSON.stringify(context);
  });

  // Default value
  Handlebars.registerHelper('default', function(value, defaultValue) {
    return value !== undefined && value !== null ? value : defaultValue;
  });

  // Truncate text
  Handlebars.registerHelper('truncate', function(str, length) {
    if (str && str.length > length) {
      return str.substring(0, length) + '...';
    }
    return str;
  });

  // Capitalize first letter
  Handlebars.registerHelper('capitalize', function(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  });

  // URL encode
  Handlebars.registerHelper('urlencode', function(str) {
    return encodeURIComponent(str);
  });
}

/**
 * Register built-in templates
 */
function registerBuiltInTemplates() {
  // Welcome email
  register('welcome', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Welcome to Halqa!</h2>
      <p>Hello {{name}},</p>
      <p>Your account has been created successfully. We're excited to have you on board!</p>
      <p><a href="{{loginUrl}}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Login to Your Account</a></p>
      <p>If you have any questions, feel free to reach out to our support team.</p>
      <p>Best regards,<br>The Halqa Team</p>
    </div>
  `);

  // Verification email
  register('verification', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Verify Your Email Address</h2>
      <p>Hello {{name}},</p>
      <p>Please verify your email address by clicking the button below:</p>
      <p><a href="{{verificationUrl}}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a></p>
      <p>Or use this verification code: <strong>{{code}}</strong></p>
      <p>This code will expire in {{expiryMinutes}} minutes.</p>
      <p>If you didn't request this verification, please ignore this email.</p>
    </div>
  `);

  // Password reset email
  register('passwordReset', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Reset Your Password</h2>
      <p>Hello {{name}},</p>
      <p>We received a request to reset your password. Click the button below to reset it:</p>
      <p><a href="{{resetUrl}}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
      <p>Or use this reset code: <strong>{{code}}</strong></p>
      <p>This code will expire in {{expiryMinutes}} minutes.</p>
      <p>If you didn't request this password reset, please ignore this email.</p>
    </div>
  `);

  // Invitation email
  register('invitation', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You're Invited!</h2>
      <p>Hello,</p>
      <p>{{inviterName}} has invited you to join {{schoolName}} on Halqa.</p>
      <p><a href="{{invitationUrl}}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Accept Invitation</a></p>
      <p>This invitation will expire in {{expiryDays}} days.</p>
    </div>
  `);

  // Notification email
  register('notification', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>{{title}}</h2>
      <p>Hello {{name}},</p>
      <p>{{message}}</p>
      {{#if actionUrl}}
      <p><a href="{{actionUrl}}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">{{actionText}}</a></p>
      {{/if}}
      <p>If you have any questions, please contact support.</p>
    </div>
  `);

  // Alert email
  register('alert', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc3545;">⚠️ Alert: {{alertType}}</h2>
      <p>Hello {{name}},</p>
      <p><strong>{{message}}</strong></p>
      {{#if details}}
      <p>Details:</p>
      <pre style="background-color: #f5f5f5; padding: 10px; border-radius: 5px;">{{details}}</pre>
      {{/if}}
      <p>Please take appropriate action.</p>
    </div>
  `);
}

/**
 * Load templates from directory
 */
async function loadTemplatesFromDir(dir) {
  try {
    const files = await fs.readdir(dir);
    
    for (const file of files) {
      if (file.endsWith('.hbs') || file.endsWith('.handlebars')) {
        const filePath = path.join(dir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const templateName = path.basename(file, path.extname(file));
        
        register(templateName, content);
        logger.debug(`[emailTemplates] Loaded template: ${templateName}`);
      }
    }
  } catch (error) {
    logger.error('[emailTemplates] Failed to load templates from directory:', error);
  }
}

/**
 * Register a template
 */
function register(name, template) {
  try {
    const compiled = Handlebars.compile(template);
    templateCache.set(name, compiled);
    logger.debug(`[emailTemplates] Registered template: ${name}`);
  } catch (error) {
    logger.error(`[emailTemplates] Failed to register template ${name}:`, error);
  }
}

/**
 * Register a partial
 */
function registerPartial(name, partial) {
  try {
    const compiled = Handlebars.compile(partial);
    Handlebars.registerPartial(name, compiled);
    partialsCache.set(name, compiled);
    logger.debug(`[emailTemplates] Registered partial: ${name}`);
  } catch (error) {
    logger.error(`[emailTemplates] Failed to register partial ${name}:`, error);
  }
}

/**
 * Render a template
 */
function render(name, data = {}) {
  const template = templateCache.get(name);
  
  if (!template) {
    logger.error(`[emailTemplates] Template not found: ${name}`);
    return null;
  }

  try {
    return template(data);
  } catch (error) {
    logger.error(`[emailTemplates] Failed to render template ${name}:`, error);
    return null;
  }
}

/**
 * Render template with error handling
 */
function renderSafe(name, data = {}, fallback = '') {
  try {
    const result = render(name, data);
    return result || fallback;
  } catch (error) {
    logger.error(`[emailTemplates] Safe render failed for ${name}:`, error);
    return fallback;
  }
}

/**
 * Check if template exists
 */
function hasTemplate(name) {
  return templateCache.has(name);
}

/**
 * Get all template names
 */
function getTemplateNames() {
  return Array.from(templateCache.keys());
}

/**
 * Remove template from cache
 */
function removeTemplate(name) {
  templateCache.delete(name);
  logger.debug(`[emailTemplates] Removed template: ${name}`);
}

/**
 * Clear all templates
 */
function clearTemplates() {
  templateCache.clear();
  partialsCache.clear();
  logger.info('[emailTemplates] Cleared all templates');
}

/**
 * Enable/disable caching
 */
function setCacheEnabled(enabled) {
  cacheEnabled = enabled;
  logger.info(`[emailTemplates] Cache ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Get template statistics
 */
function getStats() {
  return {
    templateCount: templateCache.size,
    partialCount: partialsCache.size,
    cacheEnabled,
    templateNames: getTemplateNames()
  };
}

/**
 * Pre-configured template data
 */

const welcomeTemplateData = {
  loginUrl: process.env.APP_URL + '/login'
};

const verificationTemplateData = {
  expiryMinutes: 10
};

const passwordResetTemplateData = {
  expiryMinutes: 15
};

const invitationTemplateData = {
  expiryDays: 7
};

module.exports = {
  initialize,
  register,
  registerPartial,
  render,
  renderSafe,
  hasTemplate,
  getTemplateNames,
  removeTemplate,
  clearTemplates,
  setCacheEnabled,
  getStats,
  loadTemplatesFromDir,
  registerHelpers,
  registerBuiltInTemplates,
  welcomeTemplateData,
  verificationTemplateData,
  passwordResetTemplateData,
  invitationTemplateData
};
