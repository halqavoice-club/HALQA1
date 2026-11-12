#!/usr/bin/env node
// disabled-integration.js
// Integration tests are disabled in Phase 3B-1.
// Destructive integration execution against shared/production databases is not authorized.
// This script exists so that `npm run test:integration -- --ci` works correctly
// (extra flags like --ci are handled by npm/node argument parsing, not passed to this script).
'use strict';

process.stderr.write(
  'Integration tests are disabled in Phase 3B-1 (destructive integration execution is not authorized).\n'
);
process.stderr.write(
  'Skipping integration tests -- exiting 0 so downstream CI jobs can proceed.\n'
);
process.exit(0);
