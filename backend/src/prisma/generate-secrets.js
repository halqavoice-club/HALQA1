/**
 * Generate secure JWT secrets for production
 * Run: node src/prisma/generate-secrets.js
 */
const crypto = require('crypto')

const jwtSecret = crypto.randomBytes(64).toString('hex')
const jwtRefreshSecret = crypto.randomBytes(64).toString('hex')

console.log('\n🔐 Generated Secure Secrets\n')
console.log('Copy these into your production .env:\n')
console.log(`JWT_SECRET=${jwtSecret}`)
console.log(`JWT_REFRESH_SECRET=${jwtRefreshSecret}`)
console.log('\n⚠️  Keep these secret — never commit to git!\n')
