# Enterprise Features Integration Guide

## Overview

This guide provides step-by-step instructions for integrating the newly implemented enterprise features into the Halqa backend application.

## Integration Status

✅ **Code Integration**: All enterprise middleware and utilities have been integrated into `app.js`
⏳ **Dependencies**: Need to install new npm packages
⏳ **Database**: Need to run Prisma migrations
⏳ **Configuration**: Need to set environment variables

## Step 1: Install Dependencies

Navigate to the backend directory and install the required packages:

```bash
cd backend
npm install zod @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/sdk-trace-base @opentelemetry/instrumentation-http @opentelemetry/instrumentation-express @opentelemetry/instrumentation-prisma @opentelemetry/instrumentation-redis @opentelemetry/instrumentation apollo-server-express graphql graphql-subscriptions graphql-ws @graphql-tools/schema swagger-jsdoc swagger-ui-express handlebars twilio @elastic/elasticsearch node-cron
```

## Step 2: Update Prisma Schema

Add the following models to `backend/prisma/schema.prisma`:

```prisma
model Webhook {
  id          String   @id @default(uuid())
  url         String
  events      String[]
  secret      String?
  headers     Json?
  description String?
  userId      String?
  schoolId    String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  deliveries  WebhookDelivery[]

  @@index([userId])
  @@index([schoolId])
  @@map("webhooks")
}

model WebhookDelivery {
  id          String   @id @default(uuid())
  webhookId   String
  deliveryId  String
  event       String
  success     Boolean
  error       String?
  attempt     Int
  timestamp   DateTime @default(now())

  webhook     Webhook @relation(fields: [webhookId], references: [id], onDelete: Cascade)

  @@index([webhookId])
  @@index([timestamp])
  @@map("webhook_deliveries")
}

model ScheduledJob {
  id          String   @id @default(uuid())
  name        String   @unique
  type        String
  schedule    String
  timezone    String?
  isActive    Boolean  @default(true)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  executions  JobExecution[]

  @@map("scheduled_jobs")
}

model JobExecution {
  id          String   @id @default(uuid())
  jobId       String
  name        String
  status      String
  startedAt   DateTime
  completedAt DateTime?
  error       String?

  job         ScheduledJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  @@index([jobId])
  @@index([status])
  @@map("job_executions")
}
```

## Step 3: Run Prisma Migrations

```bash
npx prisma migrate dev --name add_webhooks
npx prisma migrate dev --name add_scheduled_jobs
npx prisma migrate dev --name add_job_executions
npx prisma generate
```

## Step 4: Configure Environment Variables

Add the following variables to your `.env` file:

### Required for Basic Operation
```env
# Existing required variables
DATABASE_URL=
REDIS_URL=
JWT_SECRET=
```

### Optional - Enterprise Features

#### OpenTelemetry Tracing
```env
OTEL_SERVICE_NAME=halqa-backend
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_EXPORTER_OTLP_PROTOCOLS=grpc
```

#### Alerting
```env
SLACK_WEBHOOK_URL=
SLACK_CHANNEL=#alerts
PAGERDUTY_ROUTING_KEY=
ALERT_EMAIL_TO=admin@example.com
```

#### Redis Clustering
```env
REDIS_CLUSTER_MODE=false
REDIS_CLUSTER_NODES=127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002
REDIS_SENTINEL_MODE=false
REDIS_SENTINELS=127.0.0.1:26379,127.0.0.1:26380,127.0.0.1:26381
REDIS_SENTINEL_MASTER_NAME=mymaster
REDIS_SENTINEL_PASSWORD=
```

#### Compression
```env
COMPRESSION_ENABLED=true
COMPRESSION_LEVEL=6
COMPRESSION_THRESHOLD=1024
```

#### Feature Flags
```env
FEATURE_FLAGS_ENABLED=true
```

#### SMS (Twilio)
```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
SMS_ENABLED=true
```

#### Elasticsearch
```env
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=
ELASTICSEARCH_PASSWORD=
ELASTICSEARCH_ENABLED=true
```

#### ClamAV
```env
CLAMAV_HOST=localhost
CLAMAV_PORT=3310
CLAMAV_ENABLED=true
QUARANTINE_DIR=/tmp/quarantine
```

#### Leader Election
```env
LEADER_ELECTION_ENABLED=true
LEADER_ELECTION_TTL=30
LEADER_ELECTION_RENEW_INTERVAL=10
```

#### OpenAPI
```env
OPENAPI_ENABLED=true
OPENAPI_TITLE=Halqa API
OPENAPI_VERSION=1.0.0
```

## Step 5: Update package.json Scripts

Add the following scripts to `package.json`:

```json
{
  "scripts": {
    "test:enterprise": "jest src/tests/",
    "test:coverage": "jest --coverage",
    "migrate:dev": "npx prisma migrate dev",
    "migrate:deploy": "npx prisma migrate deploy",
    "generate:client": "npx prisma generate"
  }
}
```

## Step 6: Run Tests

```bash
npm run test:enterprise
```

## Step 7: Start the Application

```bash
npm start
```

## Verification

### Health Checks
- `GET /health` - Basic liveness
- `GET /health/liveness` - Kubernetes liveness
- `GET /health/readiness` - Kubernetes readiness
- `GET /health/startup` - Kubernetes startup
- `GET /health/detailed` - Full diagnostic

### Metrics
- `GET /metrics` - Prometheus metrics (requires METRICS_TOKEN in production)

### API Documentation
- `GET /api-docs` - Swagger UI
- `GET /api-docs/spec.json` - OpenAPI spec (JSON)
- `GET /api-docs/spec.yaml` - OpenAPI spec (YAML)

### GraphQL
- `GET /graphql` - GraphQL playground (development only)
- `POST /graphql` - GraphQL endpoint

## Middleware Order

The middleware is applied in this order in `app.js`:

1. Helmet (security headers)
2. CORS
3. Brotli compression
4. Cookie parser
5. Body parser
6. Input sanitization
7. Request logging (Morgan)
8. Distributed tracing
9. Global rate limiter
10. User rate limiter
11. Device rate limiter
12. API versioning
13. Session management
14. Response caching (API routes only)
15. Idempotency (specific routes only)

## Feature-Specific Integration

### Query Result Cache
```javascript
const queryCache = require('./utils/queryCache');

// In controllers
const users = await queryCache.getOrSet('users:all', () => {
  return prisma.user.findMany();
}, 300);
```

### BullMQ Dead Letter Queues
```javascript
const queueOptimizer = require('./utils/queueOptimizer');

// Create optimized queue
const { queue, dlqQueue } = queueOptimizer.createOptimizedQueue('email', {
  enableDLQ: true,
  maxRetries: 3
});
```

### Webhooks
```javascript
const webhook = require('./utils/webhook');

// Register webhook
await webhook.register({
  url: 'https://example.com/webhook',
  events: ['user.created', 'post.created'],
  secret: 'webhook-secret'
});

// Trigger event
await webhook.trigger('user.created', { userId: '123' });
```

### SMS
```javascript
const sms = require('./utils/sms');

// Initialize
sms.initialize();

// Send SMS
await sms.send('+1234567890', 'Your code is 123456');
```

### Email Templates
```javascript
const emailTemplates = require('./utils/emailTemplates');

// Initialize
await emailTemplates.initialize();

// Render template
const html = emailTemplates.render('welcome', { name: 'John' });
```

### Feature Flags
```javascript
const featureFlags = require('./utils/featureFlags');

// Check flag
if (featureFlags.isEnabled('newFeature', userId)) {
  // Use new feature
}
```

## Troubleshooting

### Module Not Found Errors
If you get "Module not found" errors for new packages:
1. Ensure you ran `npm install` with all the packages listed in Step 1
2. Delete `node_modules` and `package-lock.json`
3. Run `npm install` again

### Prisma Migration Errors
If migrations fail:
1. Check that your `DATABASE_URL` is correct
2. Ensure the database exists
3. Run `npx prisma migrate reset` (WARNING: This will reset your database)

### Redis Connection Errors
If Redis fails to connect:
1. Check that `REDIS_URL` is set
2. Ensure Redis is running: `docker ps | grep redis`
3. Start Redis if needed: `docker run -d -p 6379:6379 redis:7-alpine`

### Port Already in Use
If you get "EADDRINUSE" error:
1. Check what's using the port: `lsof -i :5000` (Mac/Linux) or `netstat -ano | findstr :5000` (Windows)
2. Kill the process or change the PORT in `.env`

## Performance Considerations

### Compression
- Brotli compression is enabled by default
- Compression threshold is 1024 bytes (adjust via `COMPRESSION_THRESHOLD`)
- Compression level is 6 (adjust via `COMPRESSION_LEVEL`)

### Caching
- Response caching is applied to all `/api/v1` routes with 5-minute TTL
- Query result caching should be used for frequently accessed data
- Cache invalidation is handled automatically for session changes

### Rate Limiting
- Global rate limiter: 100 requests per 15 minutes
- User rate limiter: 1000 requests per hour per user
- Device rate limiter: 500 requests per hour per device

## Security Notes

### Metrics Endpoint
- In production, `METRICS_TOKEN` must be set to a strong random value
- The default token is rejected in production
- Access requires Bearer token or query parameter

### Webhooks
- Webhook secrets should be stored securely
- Use HTTPS for webhook URLs
- Implement signature verification in webhook handlers

### Leader Election
- Leader election uses Redis locks
- Ensure Redis is configured for production use
- Consider using Redis Sentinel for high availability

## Next Steps

1. **Test in Development**: Run the application in development mode and test each feature
2. **Configure Production**: Set up production environment variables
3. **Deploy**: Deploy to your production environment
4. **Monitor**: Set up Grafana dashboards and alerting
5. **Scale**: Configure Redis clustering for horizontal scaling

## Rollback Plan

If issues occur after integration:

1. **Disable Features**: Set environment variables to disable specific features (e.g., `COMPRESSION_ENABLED=false`)
2. **Revert Code**: Use git to revert the `app.js` changes
3. **Rollback Migration**: Use `npx prisma migrate resolve` to handle failed migrations
4. **Restore Database**: Use database backups if needed

## Support

For issues or questions:
- Check the feature-specific documentation in `ENTERPRISE_FEATURES_IMPLEMENTATION.md`
- Review test files in `src/tests/` for usage examples
- Check logs for error messages
- Enable debug logging by setting `LOG_LEVEL=debug`
