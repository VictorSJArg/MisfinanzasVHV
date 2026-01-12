
const { PrismaClient } = require('@prisma/client');
console.log('Starting seed...');

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: 'file:../dev.db',
        },
    },
});

async function main() {
    try {
        console.log('Connecting...');
        const email = 'user@example.com';

        console.log('Upserting user...');
        const user = await prisma.user.upsert({
            where: { email },
            update: {},
            create: {
                email,
                name: 'Usuario Demo',
                currency: 'ARS',
            },
        });
        console.log('User ID:', user.id);

        // Default Account
        console.log('Checking accounts...');
        const accounts = await prisma.account.findMany({ where: { userId: user.id } });
        if (accounts.length === 0) {
            console.log('Creating default account...');
            await prisma.account.create({
                data: {
                    name: 'Efectivo',
                    type: 'CASH',
                    userId: user.id
                }
            });
        }

        // Income Categories
        const incomeCategories = [
            'Sueldo', 'Freelance', 'Alquileres', 'Inversiones', 'Otros Ingresos'
        ];

        console.log('Seeding income categories...');
        for (const name of incomeCategories) {
            await prisma.category.upsert({
                where: { userId_name_type: { userId: user.id, name, type: 'INCOME' } },
                update: {},
                create: { name, type: 'INCOME', userId: user.id }
            });
        }

        // Expense Categories
        const expenseCategories = [
            'Supermercado', 'Alimentos', 'Alquiler/Expensas', 'Servicios (Luz/Gas)',
            'Internet/Celular', 'Transporte', 'Salud/Farmacia', 'Restaurantes/Delivery',
            'Esparcimiento', 'Educación', 'Ropa', 'Regalos', 'Varios'
        ];

        console.log('Seeding expense categories...');
        for (const name of expenseCategories) {
            await prisma.category.upsert({
                where: { userId_name_type: { userId: user.id, name, type: 'EXPENSE' } },
                update: {},
                create: { name, type: 'EXPENSE', userId: user.id }
            });
        }

        console.log('Seeding finished successfully.');
    } catch (e) {
        console.error('Error during seeding:', e);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
