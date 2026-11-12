@echo off
cd /d "%~dp0"
node test-safety\run-jest.js src/tests/tracing.test.js
