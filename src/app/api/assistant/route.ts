import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { isAllowedAssistantPhone, requireAssistantAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/prisma';
import {
    createTransactionWithBalance,
    deleteTransactionWithBalance,
    updateTransactionWithBalance
} from '@/lib/transactions';

export const dynamic = 'force-dynamic';

type AssistantAction =
    | 'ping'
    | 'metadata'
    | 'summary'
    | 'search_transactions'
    | 'create_transaction'
    | 'update_transaction'
    | 'delete_transaction'
    | 'credit_cards';

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

async function handleMetadata() {
    const user = await getDefaultUser();
    const [categories, accounts] = await Promise.all([
        prisma.category.findMany({ where: { userId: user.id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
        prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } })
    ]);

    return json({
        success: true,
        data: {
            categories,
            accounts: accounts.map((account) => ({
                id: account.id,
                name: account.name,
                type: account.type,
                balance: Number(account.balance)
            }))
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
        reply: `Encontre ${transactions.length} transacciones por ${money(total)}.`
    });
}

async function handleCreateTransaction(payload: Record<string, unknown>, confirmed: boolean) {
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

    if (!confirmed) return requiresConfirmation('create_transaction', preview);

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

async function handleUpdateTransaction(payload: Record<string, unknown>, confirmed: boolean) {
    const id = asString(payload.id || payload.transactionId);
    if (!id) return json({ success: false, error: 'transaction id is required' }, 400);

    if (!confirmed) {
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

async function handleDeleteTransaction(payload: Record<string, unknown>, confirmed: boolean) {
    const id = asString(payload.id || payload.transactionId);
    if (!id) return json({ success: false, error: 'transaction id is required' }, 400);

    const user = await getDefaultUser();
    const existing = await prisma.transaction.findFirst({
        where: { id, userId: user.id },
        include: { category: true }
    });
    if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);

    if (!confirmed) {
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

export async function POST(request: NextRequest) {
    const authError = requireAssistantAuth(request);
    if (authError) return authError;

    try {
        const body = await request.json() as AssistantRequestBody;
        const sourcePhone = body.sourcePhone || body.from || body.phone;

        if (!isAllowedAssistantPhone(sourcePhone)) {
            return json({ success: false, error: 'Phone is not allowed' }, 403);
        }

        const action = body.action || 'ping';
        const payload = body.payload || {};

        switch (action) {
            case 'ping':
                return json({ success: true, reply: 'Assistant API online.' });
            case 'metadata':
                return handleMetadata();
            case 'summary':
                return handleSummary(payload);
            case 'search_transactions':
                return handleSearchTransactions(payload);
            case 'create_transaction':
                return handleCreateTransaction(payload, body.confirmed === true);
            case 'update_transaction':
                return handleUpdateTransaction(payload, body.confirmed === true);
            case 'delete_transaction':
                return handleDeleteTransaction(payload, body.confirmed === true);
            case 'credit_cards':
                return handleCreditCards();
            default:
                return json({ success: false, error: 'Unsupported assistant action' }, 400);
        }
    } catch (error: unknown) {
        console.error('Assistant API error:', error);
        return json({ success: false, error: errorMessage(error) }, 500);
    }
}
