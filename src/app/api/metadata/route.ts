
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';


export async function GET(request: NextRequest) {
    const user = await prisma.user.findFirst();
    if (!user) return NextResponse.json({ categories: [], accounts: [] });

    const categories = await prisma.category.findMany({
        where: { userId: user.id },
        orderBy: { name: 'asc' }
    });

    const accounts = await prisma.account.findMany({
        where: { userId: user.id },
        orderBy: { name: 'asc' }
    });

    return NextResponse.json({ categories, accounts });
}
