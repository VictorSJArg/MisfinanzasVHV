const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findFirst()
  .then(user => console.log('USER:', user))
  .catch(err => console.error('ERROR:', err))
  .finally(() => p.$disconnect());
