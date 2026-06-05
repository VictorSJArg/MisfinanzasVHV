import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVirtualItemsForCard } from '@/lib/creditCardProjections';

// GET - Listar todas las tarjetas
export async function GET() {
    try {
        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json({ error: 'No user found' }, { status: 400 });
        }

        const cards = await prisma.creditCard.findMany({
            where: { userId: user.id },
            include: {
                statements: {
                    orderBy: { dueDate: 'desc' },

                    include: {
                        items: true
                    }
                }
            },
            orderBy: { name: 'asc' }
        });

        // Inject virtual items (new monthly card transactions)
        for (const card of cards) {
            if (card.statements.length > 0) {
                const latestStatement = card.statements[0];
                const virtualItems = await getVirtualItemsForCard(user.id, card);
                latestStatement.items = [...latestStatement.items, ...virtualItems] as any;
            }
        }

        // HACK: Fetch observations manually because Prisma Client is stale (server not restarted)
        try {
            const rawItems = await prisma.$queryRaw<any[]>`SELECT id, observations FROM CreditCardItem WHERE observations IS NOT NULL`;

            // Create a lookup map
            const obsMap = new Map<string, string>();
            rawItems.forEach(row => {
                obsMap.set(row.id, row.observations as string);
            });

            // Merge into response
            cards.forEach(card => {
                card.statements.forEach(stmt => {
                    stmt.items.forEach((item: any) => {
                        if (obsMap.has(item.id)) {
                            item.observations = obsMap.get(item.id);
                        }
                    });
                });
            });

        } catch (e) {
            console.warn("Could not fetch raw observations (maybe column missing?)", e);
        }

        return NextResponse.json(cards);
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST - Crear nueva tarjeta
export async function POST(request: NextRequest) {
    try {
        const user = await prisma.user.findFirst();
        if (!user) {
            return NextResponse.json({ error: 'No user found' }, { status: 400 });
        }

        const body = await request.json();
        const { name, bank, lastFour } = body;

        if (!name || !bank) {
            return NextResponse.json({ error: 'name and bank are required' }, { status: 400 });
        }

        const card = await prisma.creditCard.create({
            data: {
                name,
                bank,
                lastFour: lastFour || null,
                userId: user.id
            }
        });

        // Create a corresponding Account of type CREDIT
        await prisma.account.create({
            data: {
                name: `${name} ${bank}`,
                type: 'CREDIT',
                balance: 0,
                userId: user.id
            }
        }).catch((err) => {
            console.error('Error creating corresponding CREDIT account:', err);
        });

        return NextResponse.json(card, { status: 201 });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE - Eliminar tarjeta
export async function DELETE(request: NextRequest) {
    try {
        const id = request.nextUrl.searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        await prisma.creditCard.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
