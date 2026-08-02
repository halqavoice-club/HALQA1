require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
async function main() {
  try {
    const result = await prisma.groupMember.findMany({
      where: { userId: "d77d00c7-221f-42c4-9e69-1946cbdfbb09", leftAt: null },
      include: {
        conversation: {
          include: {
            members: { where: { leftAt: null }, include: { user: { select: { id: true, firstName: true } } } }
          }
        }
      },
      take: 5
    });
    console.log("SUCCESS - count:", result.length);
  } catch(e) {
    console.log("ERROR:", e.message.substring(0, 300));
  } finally { await prisma.$disconnect(); }
}
main();
