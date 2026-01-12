import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// GET - Obtener overrides mensuales para un item
export async function GET(request: NextRequest) {
    try {
        const itemId = request.nextUrl.searchParams.get('itemId');

        if (!itemId) {
            // Obtener todos los overrides
            const overrides = await (prisma as any).projectionMonthlyOverride.findMany();
            return NextResponse.json({ overrides });
        }

        const overrides = await (prisma as any).projectionMonthlyOverride.findMany({
            where: { itemId }
        });

        return NextResponse.json({ overrides });
    } catch (error: any) {
        console.error('Error fetching overrides:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST - Crear o actualizar un override mensual
export async function POST(request: NextRequest) {
    try {
        const { itemId, yearMonth, amount } = await request.json();

        if (!itemId || !yearMonth || amount === undefined) {
            return NextResponse.json(
                { error: 'itemId, yearMonth y amount son requeridos' },
                { status: 400 }
            );
        }

        const override = await (prisma as any).projectionMonthlyOverride.upsert({
            where: {
                itemId_yearMonth: { itemId, yearMonth }
            },
            update: { amount: Number(amount) },
            create: {
                itemId,
                yearMonth,
                amount: Number(amount)
            }
        });

        return NextResponse.json({ success: true, override });
    } catch (error: any) {
        console.error('Error saving override:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// DELETE - Eliminar un override (volver al valor por defecto)
export async function DELETE(request: NextRequest) {
    try {
        const itemId = request.nextUrl.searchParams.get('itemId');
        const yearMonth = request.nextUrl.searchParams.get('yearMonth');

        if (!itemId || !yearMonth) {
            return NextResponse.json(
                { error: 'itemId y yearMonth son requeridos' },
                { status: 400 }
            );
        }

        await (prisma as any).projectionMonthlyOverride.delete({
            where: {
                itemId_yearMonth: { itemId, yearMonth }
            }
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        // Si no existe, no es un error
        if (error.code === 'P2025') {
            return NextResponse.json({ success: true, message: 'Override not found' });
        }
        console.error('Error deleting override:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
