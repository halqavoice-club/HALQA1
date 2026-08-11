@echo off
set NODE_ENV=test
set DATABASE_URL=mysql://root:@localhost:3306/halqa_db
set JWT_SECRET=ci_jwt_secret_at_least_32_characters_!!
set JWT_REFRESH_SECRET=ci_refresh_secret_at_least_32_chars_!!
set PORT=5001
set SERVICE_NAME=halqa-test

npx jest src/tests/phase-c.test.js src/tests/integration/ --forceExit --no-coverage --runInBand --testPathIgnorePatterns="" 2>&1
