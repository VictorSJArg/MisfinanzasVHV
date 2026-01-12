
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    const email = 'user@example.com'

    // Create or Update User
    const user = await prisma.user.upsert({
        where: { email },
        update: {},
        create: {
            email,
            name: 'Usuario Demo',
            currency: 'ARS',
        },
    })

    console.log({ user })

    // Default Account
    const account = await prisma.account.create({
        data: {
            name: 'Efectivo',
            type: 'CASH',
            userId: user.id
        }
    })

    // Income Categories
    const incomeCategories = [
        'Sueldo', 'Freelance', 'Alquileres', 'Inversiones', 'Otros Ingresos'
    ]

    for (const name of incomeCategories) {
        await prisma.category.upsert({
            where: { userId_name_type: { userId: user.id, name, type: 'INCOME' } },
            update: {},
            create: { name, type: 'INCOME', userId: user.id }
        })
    }

    // Expense Categories
    const expenseCategories = [
        'Supermercado', 'Alimentos', 'Alquiler/Expensas', 'Servicios (Luz/Gas)',
        'Internet/Celular', 'Transporte', 'Salud/Farmacia', 'Restaurantes/Delivery',
        'Esparcimiento', 'Educación', 'Ropa', 'Regalos', 'Varios'
    ]

    for (const name of expenseCategories) {
        await prisma.category.upsert({
            where: { userId_name_type: { userId: user.id, name, type: 'EXPENSE' } },
            update: {},
            create: { name, type: 'EXPENSE', userId: user.id }
        })
    }

    console.log('Seeding finished.')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
