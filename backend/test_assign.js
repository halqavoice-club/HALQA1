require('dotenv').config();
const prisma = require('./src/utils/prisma');
async function main() {
  try {
    const r = await prisma.assignmentSubmission.findMany({ where: { studentId: 'd77d00c7-221f-42c4-9e69-1946cbdfbb09' }, take: 1 });
    console.log('Assignment query OK:', r.length);
  } catch(e) { console.log('Assignment error:', e.message.substring(0,200)); }
  await prisma.();
}
main();
