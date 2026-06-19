import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function extractText(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
        return value.map(extractText).filter(Boolean).join('\n\n').trim();
    }
    if (typeof value !== 'object') return '';

    const item = value as Record<string, unknown>;
    const direct = [
        item.output,
        item.replyText,
        item.reply,
        item.message,
        item.text,
        item.response
    ];
    for (const candidate of direct) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    return extractText(item.json)
        || extractText(item.data)
        || extractText(item.appResponse)
        || extractText(item.result);
}

function extractObject(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (Array.isArray(value)) return extractObject(value[0]);
    if (typeof value !== 'object') return {};
    const item = value as Record<string, unknown>;
    if (item.json && typeof item.json === 'object') return item.json as Record<string, unknown>;
    return item;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { message, action } = body;
        const phone = process.env.ASSISTANT_ALLOWED_PHONE?.split(',')[0] || 'web-chat';

        // 1. Cargar historial
        if (action === 'history') {
            try {
                const historyRecord = await prisma.assistantHistory.findUnique({
                    where: { phone }
                });
                return NextResponse.json({
                    success: true,
                    chatHistory: historyRecord?.messages || []
                });
            } catch (e) {
                console.error('Error fetching chat history:', e);
                return NextResponse.json({ success: true, chatHistory: [] });
            }
        }

        // 2. Procesar mensaje a través de n8n
        const n8nUrl = process.env.N8N_WEBHOOK_URL;
        if (!n8nUrl) {
            return NextResponse.json({
                success: false,
                reply: '⚠️ La variable N8N_WEBHOOK_URL no está configurada en la aplicación. Por favor, agrégala en el archivo .env o en Vercel para conectar la burbuja de chat con tu flujo de n8n.'
            });
        }

        const res = await fetch(n8nUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                chatInput: message,
                phone,
                source: 'chat',
                sessionId: 'web-chat'
            })
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('n8n error response:', errText);
            return NextResponse.json({
                success: false,
                reply: `❌ Error de n8n (${res.status}): ${errText}`
            });
        }

        const n8nData = await res.json();
        const item = extractObject(n8nData);

        const reply = extractText(n8nData) || 'El flujo procesó el mensaje, pero no devolvió texto para mostrar en el chat.';
        const appResponse = (item.appResponse && typeof item.appResponse === 'object')
            ? item.appResponse as Record<string, unknown>
            : {};
        const requiresConfirmation = appResponse.requiresConfirmation === true || item.requiresConfirmation === true;
        const preview = appResponse.preview || item.preview || null;
        const refreshRequired = appResponse.processed === true || item.processed === true;

        return NextResponse.json({
            success: true,
            reply,
            requiresConfirmation,
            preview,
            refreshRequired
        });

    } catch (error: unknown) {
        console.error('Chat message API error:', error);
        return NextResponse.json({
            success: false,
            reply: `❌ Ocurrió un error en el servidor al enviar tu mensaje: ${error instanceof Error ? error.message : 'Error desconocido'}`
        }, { status: 500 });
    }
}
