@echo off
cd /d "%~dp0"
node test-safety\run-jest.js src/tests/alerting.test.js src/tests/errors.test.js
