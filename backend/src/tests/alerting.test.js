/**
 * Tests for alerting system
 */

const {
  sendSlackAlert,
  sendPagerDutyAlert,
  sendEmailAlert,
  sendWebhookAlert,
  alert,
  alertCritical,
  alertWarning,
  alertInfo
} = require('../utils/alerting');

// Mock fetch
global.fetch = jest.fn();

// Mock email utility
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue()
}));

describe('Alerting System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set required environment variables
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
    process.env.SLACK_CHANNEL = '#alerts';
    process.env.PAGERDUTY_ROUTING_KEY = 'test-key';
    process.env.ALERT_EMAIL_TO = 'admin@example.com';
  });

  afterEach(() => {
    delete process.env.SLACK_WEBHOOK_URL;
    delete process.env.SLACK_CHANNEL;
    delete process.env.PAGERDUTY_ROUTING_KEY;
    delete process.env.ALERT_EMAIL_TO;
  });

  describe('sendSlackAlert', () => {
    test('should send alert to Slack', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await sendSlackAlert({
        message: 'Test alert',
        severity: 'warning'
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('Test alert')
        })
      );
    });

    test('should skip when webhook URL not configured', async () => {
      delete process.env.SLACK_WEBHOOK_URL;

      await sendSlackAlert({ message: 'Test' });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should handle Slack API errors', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(sendSlackAlert({ message: 'Test' })).resolves.not.toThrow();
    });
  });

  describe('sendPagerDutyAlert', () => {
    test('should send alert to PagerDuty', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await sendPagerDutyAlert({
        payload: {
          summary: 'Test alert',
          severity: 'critical',
          details: { error: 'test' }
        }
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('pagerduty'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test alert')
        })
      );
    });

    test('should skip when routing key not configured', async () => {
      delete process.env.PAGERDUTY_ROUTING_KEY;

      await sendPagerDutyAlert({ payload: {} });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should handle PagerDuty API errors', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(sendPagerDutyAlert({ payload: {} })).resolves.not.toThrow();
    });
  });

  describe('sendEmailAlert', () => {
    test('should send email alert', async () => {
      const { sendEmail } = require('../utils/email');

      await sendEmailAlert({
        to: 'test@example.com',
        subject: 'Test Alert',
        body: 'Test body',
        isHtml: false
      });

      expect(sendEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Test Alert',
        'Test body',
        false
      );
    });

    test('should handle email errors', async () => {
      const { sendEmail } = require('../utils/email');
      sendEmail.mockRejectedValue(new Error('Email failed'));

      await expect(sendEmailAlert({
        to: 'test@example.com',
        subject: 'Test',
        body: 'Test'
      })).resolves.not.toThrow();
    });
  });

  describe('sendWebhookAlert', () => {
    test('should send webhook alert', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await sendWebhookAlert({
        url: 'https://example.com/webhook',
        data: { test: 'data' }
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test')
        })
      );
    });

    test('should skip when URL not provided', async () => {
      await sendWebhookAlert({ data: {} });

      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should handle webhook errors', async () => {
      global.fetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(sendWebhookAlert({
        url: 'https://example.com/webhook',
        data: {}
      })).resolves.not.toThrow();
    });
  });

  describe('alert', () => {
    test('should send alert to all configured channels', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await alert('critical', 'Test critical alert', {
        details: { error: 'test' }
      });

      expect(global.fetch).toHaveBeenCalledTimes(2); // Slack + PagerDuty
    });

    test('should route based on severity', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await alert('info', 'Test info alert', { details: {} });

      expect(global.fetch).toHaveBeenCalledTimes(1); // Only Slack
    });

    test('should use custom channels if provided', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await alert('warning', 'Test alert', {
        channels: ['slack'],
        details: {}
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('alertCritical', () => {
    test('should send critical alert', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await alertCritical('Critical issue', { details: {} });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('alertWarning', () => {
    test('should send warning alert', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await alertWarning('Warning issue', { details: {} });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('alertInfo', () => {
    test('should send info alert', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      await alertInfo('Info message', { details: {} });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('alertCircuitBreaker', () => {
    test('should send circuit breaker alert', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      const { alertCircuitBreaker } = require('../utils/alerting');
      await alertCircuitBreaker('database', 'OPEN', {
        failureCount: 5
      });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('alertHealthCheck', () => {
    test('should send health check alert', async () => {
      global.fetch.mockResolvedValue({ ok: true });

      const { alertHealthCheck } = require('../utils/alerting');
      await alertHealthCheck('database', 'error', {
        latency: 5000
      });

      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('getSeverityColor', () => {
    test('should return correct colors for each severity', () => {
      const { getSeverityColor } = require('../utils/alerting');

      expect(getSeverityColor('critical')).toBe('#FF0000');
      expect(getSeverityColor('warning')).toBe('#FFA500');
      expect(getSeverityColor('info')).toBe('#36A64F');
    });
  });

  describe('getDefaultChannels', () => {
    test('should return appropriate channels for each severity', () => {
      const { getDefaultChannels } = require('../utils/alerting');

      expect(getDefaultChannels('critical')).toContain('pagerduty');
      expect(getDefaultChannels('warning')).not.toContain('pagerduty');
      expect(getDefaultChannels('info')).toEqual(['slack']);
    });
  });
});
