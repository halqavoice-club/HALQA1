@echo off
cd /d "%~dp0"
node test-safety\run-jest.js src/tests/errors.test.js src/tests/health.test.js src/tests/idempotency.test.js src/tests/alerting.test.js src/tests/apiVersion.test.js
