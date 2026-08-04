@echo off
set NODE_ENV=test
set DATABASE_URL=mysql://root:@localhost:3306/halqa_db
set JWT_SECRET=ci_jwt_secret_at_least_32_characters_!!
set JWT_REFRESH_SECRET=ci_refresh_secret_at_least_32_chars_!!
set PORT=5001
set SERVICE_NAME=halqa-test

npx jest src/tests/errors.test.js src/tests/health.test.js src/tests/idempotency.test.js src/tests/alerting.test.js src/tests/apiVersion.test.js --forceExit --no-coverage 2>&1
