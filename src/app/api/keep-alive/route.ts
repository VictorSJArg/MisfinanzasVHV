import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Hacemos una consulta muy ligera para mantener la base de datos activa
    await prisma.category.findFirst();
    
    return NextResponse.json({ status: 'ok', message: 'Database connection is active' });
  } catch (error: any) {
    console.error("Keep-alive error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
