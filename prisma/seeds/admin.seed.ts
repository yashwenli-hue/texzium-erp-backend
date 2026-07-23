import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('Admin@123', 10);

  const role = await prisma.role.upsert({
    where: { name: 'SUPER_ADMIN' },
    update: {},
    create: {
      name: 'SUPER_ADMIN',
      description: 'System Super Admin',
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'admin@texzium.com' },
    update: {},
    create: {
      fullName: 'Texzium Super Admin',
      email: 'admin@texzium.com',
      passwordHash: hashedPassword,
      roleId: role.id,
    },
  });

  console.log('Super Admin Created:', user.email);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
