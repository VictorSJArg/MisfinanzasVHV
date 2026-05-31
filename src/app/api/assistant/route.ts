import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { isAllowedAssistantPhone, requireAssistantAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/prisma';
import {
    createTransactionWithBalance,
    deleteTransactionWithBalance,
    updateTransactionWithBalance,
    balanceMultiplier
} from '@/lib/transactions';

export const dynamic = 'force-dynamic';

type AssistantAction =
    | 'ping'
    | 'metadata'
    | 'summary'
    | 'search_transactions'
    | 'confirm'
    | 'create_transaction'
    | 'create_transactions_bulk'
    | 'update_transaction'
    | 'delete_transaction'
    | 'credit_cards'
    | 'log_reply';

interface AssistantRequestBody {
    action?: AssistantAction;
    payload?: Record<string, unknown>;
    confirmed?: boolean;
    sourcePhone?: string;
    from?: string;
    phone?: string;
}

function json(data: unknown, status = 200) {
    return NextResponse.json(data, { status });
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

function money(value: number) {
    return `$${value.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

async function getAssistantHistory(phone: string): Promise<{ role: string; content: string }[]> {
    if (!phone) return [];
    try {
        const history = await prisma.assistantHistory.findUnique({
            where: { phone }
        });
        if (!history || !history.messages || !Array.isArray(history.messages)) return [];
        return history.messages as { role: string; content: string }[];
    } catch (e) {
        console.error('Error fetching chat history:', e);
        return [];
    }
}

async function appendToAssistantHistory(phone: string, role: 'user' | 'assistant', content: string) {
    if (!phone || !content) return;
    try {
        const current = await getAssistantHistory(phone);
        const updated = [...current, { role, content }].slice(-20); // Keep last 20 messages to control token usage
        await prisma.assistantHistory.upsert({
            where: { phone },
            update: { messages: updated as any },
            create: { phone, messages: updated as any }
        });
    } catch (e) {
        console.error('Error saving chat history:', e);
    }
}

async function getDefaultUser() {
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found');
    return user;
}

function asString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return parsed;
}

function asBoolean(value: unknown) {
    return value === true || value === 'true';
}

function getMonthRange(payload: Record<string, unknown>) {
    const now = new Date();
    const month = asNumber(payload.month) || now.getMonth() + 1;
    const year = asNumber(payload.year) || now.getFullYear();
    const baseDate = new Date(year, month - 1, 15);

    return {
        start: startOfMonth(baseDate),
        end: endOfMonth(baseDate),
        label: format(baseDate, 'MMMM yyyy', { locale: es })
    };
}

function requiresConfirmation(action: AssistantAction, preview: unknown) {
    return json({
        success: false,
        requiresConfirmation: true,
        action,
        preview,
        reply: 'Necesito confirmacion explicita antes de modificar datos.'
    }, 409);
}

async function resolveAccountId(userId: string, payload: Record<string, unknown>) {
    const accountId = asString(payload.accountId);
    if (accountId) return accountId;

    const accountName = asString(payload.accountName);
    if (accountName) {
        const account = await prisma.account.findFirst({
            where: {
                userId,
                name: { contains: accountName, mode: 'insensitive' }
            }
        });
        if (account) return account.id;
    }

    const account = await prisma.account.findFirst({ where: { userId } });
    if (!account) throw new Error('No account found');
    return account.id;
}

async function resolveCategoryId(userId: string, type: string, payload: Record<string, unknown>) {
    const categoryId = asString(payload.categoryId);
    if (categoryId) return categoryId;

    const categoryName = asString(payload.categoryName || payload.category);
    if (!categoryName) return null;

    const existing = await prisma.category.findFirst({
        where: {
            userId,
            type,
            name: { equals: categoryName, mode: 'insensitive' }
        }
    });
    if (existing) return existing.id;

    if (!asBoolean(payload.createMissingCategory)) return null;

    const category = await prisma.category.create({
        data: {
            name: categoryName,
            type,
            userId
        }
    });

    return category.id;
}

async function handleMetadata(payload: Record<string, unknown>, phone: string) {
    const user = await getDefaultUser();
    const [categories, accounts] = await Promise.all([
        prisma.category.findMany({ where: { userId: user.id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
        prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } })
    ]);

    const incomingText = asString(payload.text || payload.message);
    if (incomingText) {
        await appendToAssistantHistory(phone, 'user', incomingText);
    }

    const chatHistory = await getAssistantHistory(phone);

    return json({
        success: true,
        data: {
            categories,
            accounts: accounts.map((account) => ({
                id: account.id,
                name: account.name,
                type: account.type,
                balance: Number(account.balance)
            })),
            chatHistory
        },
        reply: `Tengo ${categories.length} categorias y ${accounts.length} cuentas disponibles.`
    });
}

async function handleSummary(payload: Record<string, unknown>) {
    const user = await getDefaultUser();
    const range = getMonthRange(payload);

    const transactions = await prisma.transaction.findMany({
        where: {
            userId: user.id,
            date: { gte: range.start, lte: range.end }
        },
        include: { category: true }
    });

    const income = transactions
        .filter((transaction) => transaction.type === 'INCOME')
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const expense = transactions
        .filter((transaction) => transaction.type === 'EXPENSE' && transaction.status !== 'CANCELLED')
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);
    const pending = transactions
        .filter((transaction) => transaction.status === 'PENDING')
        .reduce((sum, transaction) => sum + Number(transaction.amount), 0);

    return json({
        success: true,
        data: {
            period: range.label,
            income,
            expense,
            balance: income - expense,
            pending,
            transactionCount: transactions.length
        },
        reply: `Resumen de ${range.label}: ingresos ${money(income)}, gastos ${money(expense)}, balance ${money(income - expense)}.`
    });
}

async function handleSearchTransactions(payload: Record<string, unknown>) {
    const user = await getDefaultUser();
    const where: Prisma.TransactionWhereInput = { userId: user.id };
    const query = asString(payload.query || payload.text);
    const type = asString(payload.type).toUpperCase();
    const category = asString(payload.category || payload.categoryName);
    const startDate = asString(payload.startDate);
    const endDate = asString(payload.endDate);
    const limit = asNumber(payload.limit) || 10;

    if (query) {
        const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
        if (words.length > 0) {
            where.OR = words.map((word) => ({
                description: { contains: word, mode: 'insensitive' }
            }));
        }
    }

    if (type === 'INCOME' || type === 'EXPENSE') {
        where.type = type;
    }

    if (category) {
        where.category = {
            name: { contains: category, mode: 'insensitive' }
        };
    }

    if (startDate || endDate) {
        where.date = {};
        if (startDate) where.date.gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.date.lte = end;
        }
    }

    const minAmount = asNumber(payload.minAmount);
    const maxAmount = asNumber(payload.maxAmount);
    if (minAmount !== undefined || maxAmount !== undefined) {
        where.amount = {};
        if (minAmount !== undefined) where.amount.gte = minAmount;
        if (maxAmount !== undefined) where.amount.lte = maxAmount;
    }

    const transactions = await prisma.transaction.findMany({
        where,
        include: { category: true, account: true },
        orderBy: { date: 'desc' },
        take: Math.min(Math.max(limit, 1), 50)
    });

    const total = transactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);

    let reply = 'No encontré transacciones.';
    if (transactions.length > 0) {
        const listText = transactions.map((t) => {
            const dateStr = format(new Date(t.date), 'dd/MM');
            const sign = t.type === 'EXPENSE' ? '-' : '+';
            const cat = t.category?.name ? ` (${t.category.name})` : '';
            const desc = t.description ? ` - ${t.description}` : '';
            return `• ${dateStr}${desc}${cat}: ${sign}${money(Number(t.amount))}`;
        }).join('\n');
        
        reply = `Encontré ${transactions.length} transacciones por un total de ${money(total)}:\n${listText}`;
    }

    return json({
        success: true,
        data: {
            transactions: transactions.map((transaction) => ({
                id: transaction.id,
                date: transaction.date,
                amount: Number(transaction.amount),
                type: transaction.type,
                status: transaction.status,
                description: transaction.description,
                category: transaction.category?.name || null,
                account: transaction.account?.name || null
            })),
            totalAmount: total,
            totalFound: transactions.length
        },
        reply
    });
}

async function handleCreateTransaction(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const amount = asNumber(payload.amount);
    const type = asString(payload.type || payload.transactionType).toUpperCase() || 'EXPENSE';
    const date = asString(payload.date) || new Date().toISOString();
    const description = asString(payload.description);

    if (!amount || amount <= 0) {
        return json({ success: false, error: 'amount is required and must be greater than zero' }, 400);
    }
    if (type !== 'INCOME' && type !== 'EXPENSE') {
        return json({ success: false, error: 'type must be INCOME or EXPENSE' }, 400);
    }

    const preview = {
        amount,
        type,
        date,
        description,
        categoryName: payload.categoryName || payload.category || null,
        status: payload.status || 'PAID'
    };

    if (!confirmed) {
        await saveAssistantSession(phone, 'create_transaction', payload);
        return requiresConfirmation('create_transaction', preview);
    }

    const user = await getDefaultUser();
    const accountId = await resolveAccountId(user.id, payload);
    const categoryId = await resolveCategoryId(user.id, type, payload);

    const transaction = await createTransactionWithBalance({
        amount,
        date,
        type,
        description: description || null,
        categoryId,
        accountId,
        userId: user.id,
        status: asString(payload.status) || 'PAID'
    });

    return json({
        success: true,
        data: { transaction },
        reply: `Listo. Cargue ${type === 'INCOME' ? 'un ingreso' : 'un gasto'} de ${money(amount)}.`
    });
}

interface ParsedBulkTransaction {
    amount: number;
    type: 'INCOME' | 'EXPENSE';
    date: string;
    description: string;
    categoryName: string;
    status: string;
}

async function handleCreateTransactionsBulk(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const rawTransactions = payload.transactions as Record<string, unknown>[] | undefined;
    if (!rawTransactions || !Array.isArray(rawTransactions) || rawTransactions.length === 0) {
        return json({ success: false, error: 'transactions array is required' }, 400);
    }

    const parsedTransactions: ParsedBulkTransaction[] = [];
    let totalAmount = 0;

    for (const tx of rawTransactions) {
        const amount = asNumber(tx.amount);
        const type = (asString(tx.type || tx.transactionType).toUpperCase() || 'EXPENSE') as 'INCOME' | 'EXPENSE';
        const date = asString(tx.date) || new Date().toISOString();
        const description = asString(tx.description);
        const categoryName = asString(tx.categoryName || tx.category);

        if (!amount || amount <= 0) {
            return json({ success: false, error: 'amount is required and must be greater than zero for all transactions' }, 400);
        }
        totalAmount += amount;

        parsedTransactions.push({
            amount,
            type,
            date,
            description,
            categoryName,
            status: asString(tx.status) || 'PAID'
        });
    }

    const typeLabel = parsedTransactions[0].type === 'INCOME' ? 'ingresos' : 'gastos';

    const preview = {
        totalAmount,
        type: parsedTransactions[0].type,
        count: parsedTransactions.length,
        transactions: parsedTransactions
    };

    if (!confirmed) {
        await saveAssistantSession(phone, 'create_transactions_bulk', payload);
        return json({
            success: false,
            requiresConfirmation: true,
            action: 'create_transactions_bulk',
            preview,
            reply: `Necesito confirmacion para cargar ${parsedTransactions.length} ${typeLabel} por un total de ${money(totalAmount)}.`
        }, 409);
    }

    const user = await getDefaultUser();
    
    try {
        const created = await prisma.$transaction(async (tx) => {
            const results = [];
            for (const item of parsedTransactions) {
                const accountId = await resolveAccountId(user.id, payload);
                const categoryId = await resolveCategoryId(user.id, item.type, {
                    categoryName: item.categoryName,
                    createMissingCategory: payload.createMissingCategory
                });

                const createdTx = await tx.transaction.create({
                    data: {
                        amount: item.amount,
                        date: new Date(item.date),
                        type: item.type,
                        description: item.description || null,
                        categoryId,
                        accountId,
                        userId: user.id,
                        status: item.status
                    }
                });

                await tx.account.update({
                    where: { id: accountId },
                    data: { balance: { increment: item.amount * balanceMultiplier(item.type) } }
                });

                results.push(createdTx);
            }
            return results;
        });

        return json({
            success: true,
            data: { transactions: created },
            reply: `Listo. Cargue ${created.length} ${typeLabel} por un total de ${money(totalAmount)}.`
        });
    } catch (e) {
        console.error('Error creating bulk transactions:', e);
        return json({ success: false, error: errorMessage(e) }, 500);
    }
}

async function handleUpdateTransaction(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const id = asString(payload.id || payload.transactionId);
    if (!id) return json({ success: false, error: 'transaction id is required' }, 400);

    if (!confirmed) {
        await saveAssistantSession(phone, 'update_transaction', payload);
        return requiresConfirmation('update_transaction', {
            id,
            amount: payload.amount,
            date: payload.date,
            description: payload.description,
            categoryId: payload.categoryId,
            accountId: payload.accountId,
            type: payload.type,
            status: payload.status
        });
    }

    const user = await getDefaultUser();
    const existing = await prisma.transaction.findFirst({ where: { id, userId: user.id } });
    if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);

    const transaction = await updateTransactionWithBalance(id, {
        amount: payload.amount as number | string | undefined,
        date: payload.date as string | undefined,
        description: payload.description as string | undefined,
        categoryId: payload.categoryId as string | undefined,
        accountId: payload.accountId as string | undefined,
        type: payload.type as 'INCOME' | 'EXPENSE' | undefined,
        status: payload.status as string | undefined
    });

    return json({
        success: true,
        data: { transaction },
        reply: 'Listo. Actualice la transaccion.'
    });
}

async function handleDeleteTransaction(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const id = asString(payload.id || payload.transactionId);
    if (!id) return json({ success: false, error: 'transaction id is required' }, 400);

    const user = await getDefaultUser();
    const existing = await prisma.transaction.findFirst({
        where: { id, userId: user.id },
        include: { category: true }
    });
    if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);

    if (!confirmed) {
        await saveAssistantSession(phone, 'delete_transaction', { id });
        return requiresConfirmation('delete_transaction', {
            id,
            amount: Number(existing.amount),
            date: existing.date,
            description: existing.description,
            category: existing.category?.name || null
        });
    }

    await deleteTransactionWithBalance(id);

    return json({
        success: true,
        data: {
            deletedTransaction: {
                id: existing.id,
                amount: Number(existing.amount),
                description: existing.description,
                date: existing.date
            }
        },
        reply: 'Listo. Elimine la transaccion.'
    });
}

async function handleCreditCards() {
    const user = await getDefaultUser();
    const cards = await prisma.creditCard.findMany({
        where: { userId: user.id },
        include: {
            statements: {
                orderBy: { dueDate: 'desc' },
                take: 3,
                include: { items: true }
            }
        },
        orderBy: { name: 'asc' }
    });

    const data = cards.map((card) => {
        const latestStatement = card.statements[0];
        return {
            id: card.id,
            name: card.name,
            bank: card.bank,
            lastFour: card.lastFour,
            latestStatement: latestStatement ? {
                id: latestStatement.id,
                dueDate: latestStatement.dueDate,
                closingDate: latestStatement.closingDate,
                totalAmount: Number(latestStatement.totalAmount),
                itemCount: latestStatement.items.length
            } : null
        };
    });

    const total = data.reduce((sum, card) => sum + (card.latestStatement?.totalAmount || 0), 0);

    return json({
        success: true,
        data: { cards: data, totalLatestStatements: total },
        reply: `Tengo ${data.length} tarjetas registradas. Total ultimos resumenes: ${money(total)}.`
    });
}

async function saveAssistantSession(phone: string, action: string, payload: Record<string, unknown>) {
    if (!phone) return;
    await prisma.assistantSession.upsert({
        where: { phone },
        update: { action, payload: payload as any, createdAt: new Date() },
        create: { phone, action, payload: payload as any }
    });
}

async function handleConfirm(payload: Record<string, unknown>, phone: string) {
    if (!phone) {
        return json({ success: true, processed: false });
    }

    const session = await prisma.assistantSession.findUnique({
        where: { phone }
    });

    if (!session) {
        return json({ success: true, processed: false });
    }

    const text = asString(payload.text).trim().toLowerCase();
    const yesWords = ['si', 'sí', 'confirmo', 'confirmar', 'ok', 'dale', 'guardar', 'cargar'];
    const noWords = ['no', 'cancelar', 'cancela', 'anular', 'descartar'];

    if (yesWords.includes(text)) {
        let response;
        try {
            await appendToAssistantHistory(phone, 'user', text);
            if (session.action === 'create_transaction') {
                response = await handleCreateTransaction(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'create_transactions_bulk') {
                response = await handleCreateTransactionsBulk(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'update_transaction') {
                response = await handleUpdateTransaction(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'delete_transaction') {
                response = await handleDeleteTransaction(session.payload as Record<string, unknown>, true, phone);
            } else {
                await prisma.assistantSession.delete({ where: { id: session.id } });
                return json({ success: true, processed: false });
            }

            const resData = await response.json();
            await prisma.assistantSession.delete({ where: { id: session.id } });
            
            await appendToAssistantHistory(phone, 'assistant', resData.reply || 'Acción confirmada.');
            
            return json({
                success: true,
                processed: true,
                reply: resData.reply || 'Acción confirmada.'
            });
        } catch (error) {
            console.error('Error executing pending action:', error);
            return json({ success: false, error: errorMessage(error) }, 500);
        }
    }

    if (noWords.includes(text)) {
        await appendToAssistantHistory(phone, 'user', text);
        await prisma.assistantSession.delete({ where: { id: session.id } });
        const reply = 'Cancelado. No hice cambios.';
        await appendToAssistantHistory(phone, 'assistant', reply);
        return json({
            success: true,
            processed: true,
            reply
        });
    }

    // Si dice cualquier otra cosa, descartamos la confirmación pendiente
    // y dejamos que continúe el flujo
    await prisma.assistantSession.delete({ where: { id: session.id } });
    return json({ success: true, processed: false });
}

export async function POST(request: NextRequest) {
    const authError = requireAssistantAuth(request);
    if (authError) return authError;

    try {
        const body = await request.json() as AssistantRequestBody;
        const sourcePhone = body.sourcePhone || body.from || body.phone || '';

        if (!isAllowedAssistantPhone(sourcePhone)) {
            return json({ success: false, error: 'Phone is not allowed' }, 403);
        }

        const action = body.action || 'ping';
        const payload = body.payload || {};

        switch (action) {
            case 'ping':
                return json({ success: true, reply: 'Assistant API online.' });
            case 'metadata':
                return handleMetadata(payload, sourcePhone);
            case 'summary':
                return handleSummary(payload);
            case 'search_transactions':
                return handleSearchTransactions(payload);
            case 'confirm':
                return handleConfirm(payload, sourcePhone);
            case 'create_transaction':
                return handleCreateTransaction(payload, body.confirmed === true, sourcePhone);
            case 'create_transactions_bulk':
                return handleCreateTransactionsBulk(payload, body.confirmed === true, sourcePhone);
            case 'update_transaction':
                return handleUpdateTransaction(payload, body.confirmed === true, sourcePhone);
            case 'delete_transaction':
                return handleDeleteTransaction(payload, body.confirmed === true, sourcePhone);
            case 'credit_cards':
                return handleCreditCards();
            case 'log_reply':
                const role = asString(payload.role) === 'user' ? 'user' : 'assistant';
                const text = asString(payload.text);
                if (text) {
                    await appendToAssistantHistory(sourcePhone, role, text);
                }
                return json({ success: true });
            default:
                return json({ success: false, error: 'Unsupported assistant action' }, 400);
        }
    } catch (error: unknown) {
        console.error('Assistant API error:', error);
        return json({ success: false, error: errorMessage(error) }, 500);
    }
}
