import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { isAllowedAssistantPhone, requireAssistantAuth } from '@/lib/apiAuth';
import { prisma } from '@/lib/prisma';
import {
    createOutboundMessage,
    createPersonalContact,
    createPersonalEvent,
    createPersonalReminder,
    createPersonalTask,
    findPersonalItemCandidates,
    findPersonalContact,
    getPersonalAssistantOverview,
    phoneFromPayload,
    personalActionPreview,
    postponePersonalReminder,
    searchPersonalItems,
    sendOutboundMessageNow,
    updatePersonalEvent,
    updatePersonalReminder,
    updatePersonalTask,
    updatePersonalReminderStatus,
    updatePersonalTaskStatus
} from '@/lib/personalAssistant';
import {
    createTransactionWithBalance,
    deleteTransactionWithBalance,
    deleteTransactionsWithBalance,
    updateTransactionWithBalance,
    balanceMultiplier
} from '@/lib/transactions';
import { getCreditCardProjectionsForRange, CreditCardProjection } from '@/lib/creditCardProjections';

export const dynamic = 'force-dynamic';
const ASSISTANT_SESSION_TTL_MS = 15 * 60 * 1000;

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
    | 'delete_transactions_bulk'
    | 'dashboard_analysis'
    | 'credit_cards'
    | 'personal_overview'
    | 'search_personal_items'
    | 'create_personal_contact'
    | 'create_personal_reminder'
    | 'create_personal_task'
    | 'create_personal_event'
    | 'create_outbound_message'
    | 'send_outbound_message'
    | 'update_personal_task'
    | 'update_personal_reminder'
    | 'update_personal_event'
    | 'update_personal_item'
    | 'postpone_personal_reminder'
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

function lastDigits(value: string | null | undefined, length = 4) {
    return String(value || '').slice(-length);
}

function assistantDateTime(value: Date | string, timeZone = 'America/Argentina/Buenos_Aires') {
    return new Intl.DateTimeFormat('es-AR', {
        timeZone,
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(new Date(value));
}

function assistantDateKey(value: Date | string, timeZone = 'America/Argentina/Buenos_Aires') {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date(value));
}

function assistantDateShort(value: Date | string, timeZone = 'America/Argentina/Buenos_Aires') {
    return new Intl.DateTimeFormat('es-AR', {
        timeZone,
        day: '2-digit',
        month: '2-digit'
    }).format(new Date(value));
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
            update: { messages: updated as Prisma.JsonArray },
            create: { phone, messages: updated as Prisma.JsonArray }
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

function assistantSessionExpired(createdAt: Date) {
    return Date.now() - createdAt.getTime() > ASSISTANT_SESSION_TTL_MS;
}

async function cleanupExpiredAssistantSessions() {
    await prisma.assistantSession.deleteMany({
        where: {
            createdAt: { lt: new Date(Date.now() - ASSISTANT_SESSION_TTL_MS) }
        }
    });
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

function compactDate(value: Date | string | null | undefined) {
    if (!value) return 'sin fecha';
    return assistantDateTime(value);
}

function normalizeSearchText(value: unknown) {
    return asString(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function wordsFromQuery(value: unknown) {
    const ignored = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para', 'por', 'que']);
    return normalizeSearchText(value)
        .split(' ')
        .filter((word) => word.length > 1 && !ignored.has(word));
}

function shouldUseLatestTransaction(payload: Record<string, unknown>) {
    const text = normalizeSearchText([
        payload.query,
        payload.text,
        payload.target,
        payload.descriptionTarget,
        payload.reference
    ].filter(Boolean).join(' '));
    return asBoolean(payload.useLatest) ||
        asBoolean(payload.latest) ||
        asBoolean(payload.lastCreated) ||
        /\b(ultimo|ultima|recien|reciente|que cree|que cargue|creado recien|cargado recien)\b/.test(text);
}

function transactionSelectionPayload(action: AssistantAction, payload: Record<string, unknown>, candidates: Array<{
    id: string;
    date: Date;
    amount: unknown;
    type: string;
    status: string;
    description: string | null;
    category: { name: string } | null;
    account: { name: string } | null;
}>) {
    return {
        action,
        originalPayload: payload,
        candidates: candidates.map((transaction, index) => ({
            option: index + 1,
            id: transaction.id,
            date: format(transaction.date, 'yyyy-MM-dd'),
            amount: Number(transaction.amount),
            type: transaction.type,
            status: transaction.status,
            description: transaction.description,
            category: transaction.category?.name || null,
            account: transaction.account?.name || null
        }))
    };
}

function transactionCandidatesReply(candidates: Array<{
    date: Date;
    amount: unknown;
    type: string;
    status: string;
    description: string | null;
    category: { name: string } | null;
    account: { name: string } | null;
}>) {
    const lines = candidates.slice(0, 8).map((transaction, index) => {
        const type = transaction.type === 'INCOME' ? 'ingreso' : 'gasto';
        const description = transaction.description || transaction.category?.name || 'sin descripcion';
        const category = transaction.category?.name ? `, ${transaction.category.name}` : '';
        return `${index + 1}) ${format(transaction.date, 'dd/MM')} ${type} ${money(Number(transaction.amount))}: ${description}${category} [${transaction.status}]`;
    });
    return `Encontre ${candidates.length} registros posibles. Decime el numero de cual queres usar:\n${lines.join('\n')}`;
}

async function resolveTransactionTarget(userId: string, payload: Record<string, unknown>, action: AssistantAction, phone: string) {
    const explicitSourceType = asString(payload.sourceType).toUpperCase();
    let id = asString(payload.id || payload.transactionId);
    if (!id && explicitSourceType === 'TRANSACTION') id = asString(payload.sourceId);
    if (id) {
        const transaction = await prisma.transaction.findFirst({
            where: { id, userId },
            include: { category: true, account: true }
        });
        if (!transaction) {
            return { response: json({ success: false, error: 'Transaction not found' }, 404) };
        }
        return { transaction };
    }

    if (shouldUseLatestTransaction(payload)) {
        const transaction = await prisma.transaction.findFirst({
            where: { userId },
            include: { category: true, account: true },
            orderBy: { createdAt: 'desc' }
        });
        if (!transaction) {
            return { response: json({ success: false, error: 'No se encontro ninguna transaccion reciente.' }, 404) };
        }
        return { transaction };
    }

    const where: Prisma.TransactionWhereInput = { userId };
    const type = asString(payload.type).toUpperCase();
    const category = asString(payload.category || payload.categoryName);
    const query = asString(payload.query || payload.target || payload.descriptionTarget || payload.text);
    const startDate = asString(payload.startDate || payload.fromDate || payload.from);
    const endDate = asString(payload.endDate || payload.toDate || payload.to);
    const date = asString(payload.date || payload.day || payload.onDate);
    const amount = asNumber(payload.amount);
    const minAmount = asNumber(payload.minAmount);
    const maxAmount = asNumber(payload.maxAmount);
    const status = asString(payload.statusFilter || payload.currentStatus).toUpperCase();

    if (type === 'INCOME' || type === 'EXPENSE') where.type = type;
    if (category) {
        where.category = { name: { contains: category, mode: 'insensitive' } };
    }
    if (date || startDate || endDate) {
        const start = new Date(startDate || date);
        const end = new Date(endDate || date || startDate);
        end.setHours(23, 59, 59, 999);
        where.date = {};
        if (!Number.isNaN(start.getTime())) where.date.gte = start;
        if (!Number.isNaN(end.getTime())) where.date.lte = end;
    }
    if (amount !== undefined || minAmount !== undefined || maxAmount !== undefined) {
        where.amount = {};
        if (amount !== undefined) {
            where.amount.gte = amount;
            where.amount.lte = amount;
        }
        if (minAmount !== undefined) where.amount.gte = minAmount;
        if (maxAmount !== undefined) where.amount.lte = maxAmount;
    }
    if (status) where.status = status;

    const words = wordsFromQuery(query);
    if (words.length > 0) {
        where.AND = words.map((word) => ({
            description: { contains: word, mode: 'insensitive' }
        }));
    }

    const hasUsefulFilter = Boolean(type || category || date || startDate || endDate || amount !== undefined || minAmount !== undefined || maxAmount !== undefined || status || words.length > 0);
    if (!hasUsefulFilter) {
        return {
            response: json({
                success: true,
                processed: true,
                needsSelection: true,
                reply: 'Necesito un dato mas para ubicar el registro: fecha, monto, categoria, descripcion o que me digas "el que cargaste recien".'
            })
        };
    }

    const candidates = await prisma.transaction.findMany({
        where,
        include: { category: true, account: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 9
    });

    if (candidates.length === 0) {
        return { response: json({ success: true, processed: true, reply: 'No encontre registros con esos datos. Pasame fecha, monto o descripcion para afinar la busqueda.' }) };
    }
    if (candidates.length === 1) return { transaction: candidates[0] };

    await saveAssistantSession(phone, `select_${action}`, transactionSelectionPayload(action, payload, candidates));
    return {
        response: json({
            success: true,
            processed: true,
            needsSelection: true,
            candidates: transactionSelectionPayload(action, payload, candidates).candidates,
            reply: transactionCandidatesReply(candidates)
        })
    };
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

    let categoryName = asString(payload.categoryName || payload.category);
    if (!categoryName) return null;

    // Clean date suffixes like " - 10/06" or " 10/06" or " - 10-06"
    categoryName = categoryName.replace(/\s*-\s*\d{2}[/\-]\d{2}\s*$/, '').replace(/\s+\d{2}[/\-]\d{2}\s*$/, '').trim();
    if (!categoryName) return null;

    const existing = await prisma.category.findFirst({
        where: {
            userId,
            type,
            name: { equals: categoryName, mode: 'insensitive' }
        }
    });
    if (existing) {
        let parentCategoryName = asString(payload.parentCategoryName || payload.parentCategory);
        if (!existing.parentId && parentCategoryName) {
            parentCategoryName = parentCategoryName.replace(/\s*-\s*\d{2}[/\-]\d{2}\s*$/, '').replace(/\s+\d{2}[/\-]\d{2}\s*$/, '').trim();
            const parentCat = await prisma.category.findFirst({
                where: {
                    userId,
                    type,
                    name: { equals: parentCategoryName, mode: 'insensitive' }
                }
            });
            if (parentCat) {
                await prisma.category.update({
                    where: { id: existing.id },
                    data: { parentId: parentCat.id }
                });
                existing.parentId = parentCat.id;
            }
        }
        return existing.id;
    }

    if (!asBoolean(payload.createMissingCategory)) return null;

    let parentId: string | null = null;
    let parentCategoryName = asString(payload.parentCategoryName || payload.parentCategory);
    if (parentCategoryName) {
        parentCategoryName = parentCategoryName.replace(/\s*-\s*\d{2}[/\-]\d{2}\s*$/, '').replace(/\s+\d{2}[/\-]\d{2}\s*$/, '').trim();
        const parentCat = await prisma.category.findFirst({
            where: {
                userId,
                type,
                name: { equals: parentCategoryName, mode: 'insensitive' }
            }
        });
        if (parentCat) {
            parentId = parentCat.id;
        }
    }

    const category = await prisma.category.create({
        data: {
            name: categoryName,
            type,
            userId,
            parentId
        }
    });

    return category.id;
}

async function handleMetadata(payload: Record<string, unknown>, phone: string) {
    const user = await getDefaultUser();
    await cleanupExpiredAssistantSessions();
    const [categories, accounts, personalContacts, pendingSession] = await Promise.all([
        prisma.category.findMany({ where: { userId: user.id }, orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
        prisma.account.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } }),
        prisma.personalContact.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' }, take: 100 }),
        phone ? prisma.assistantSession.findUnique({ where: { phone } }) : Promise.resolve(null)
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
            personalContacts: personalContacts.map((contact) => ({
                id: contact.id,
                name: contact.name,
                phone: contact.phone,
                alias: contact.alias,
                relation: contact.relation
            })),
            chatHistory,
            pendingAssistantSession: pendingSession && !assistantSessionExpired(pendingSession.createdAt) ? {
                action: pendingSession.action,
                payload: pendingSession.payload,
                createdAt: pendingSession.createdAt
            } : null
        },
        reply: `Tengo ${categories.length} categorias, ${accounts.length} cuentas y ${personalContacts.length} contactos disponibles.`
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
        parentCategoryName: payload.parentCategoryName || payload.parentCategory || null,
        accountName: payload.accountName || payload.account || null,
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
    parentCategoryName: string;
    parentCategory: string;
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
            parentCategoryName: asString(tx.parentCategoryName),
            parentCategory: asString(tx.parentCategory),
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
                    parentCategoryName: payload.parentCategoryName || payload.parentCategory || item.parentCategoryName || item.parentCategory,
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
    const user = await getDefaultUser();
    const sourceType = asString(payload.sourceType).toUpperCase();
    if (sourceType === 'PROJECTION' && !asString(payload.id || payload.transactionId)) {
        return json({
            success: true,
            processed: true,
            reply: 'Esa alerta parece venir de una proyeccion o tarjeta. Pasame el consumo/registro exacto o buscalo por fecha y descripcion para editarlo sin tocar algo equivocado.'
        });
    }

    const resolved = await resolveTransactionTarget(user.id, payload, 'update_transaction', phone);
    if ('response' in resolved) return resolved.response;
    const existing = resolved.transaction;
    const id = existing.id;
    payload.id = id;

    if (shouldUseLatestTransaction({})) {
        // Fallback to the latest transaction created by this user
        const latestTx = await prisma.transaction.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        });
        if (!latestTx) {
            return json({ success: false, error: 'No se encontró ninguna transacción para modificar.' }, 404);
        }
        payload.id = latestTx!.id;
        payload.id = id; // Ensure ID is saved in session payload
    }

    if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);

    const nextType = asString(payload.type).toUpperCase() || existing.type;
    const categoryId = asString(payload.categoryId) ||
        (payload.categoryName || payload.category ? await resolveCategoryId(user.id, nextType, payload) : undefined);
    const accountId = asString(payload.accountId) ||
        (payload.accountName || payload.account ? await resolveAccountId(user.id, { accountName: payload.accountName || payload.account }) : undefined);

    if (categoryId) payload.categoryId = categoryId;
    if (accountId) payload.accountId = accountId;

    if (!confirmed) {
        await saveAssistantSession(phone, 'update_transaction', payload);
        const previewCategory = categoryId
            ? await prisma.category.findFirst({ where: { id: categoryId, userId: user.id } })
            : existing.category;
        const previewAccount = accountId
            ? await prisma.account.findFirst({ where: { id: accountId, userId: user.id } })
            : existing.account;
        
        // Build a complete preview of the final state after update
        const preview = {
            id,
            previous: {
                amount: Number(existing.amount),
                date: format(existing.date, 'yyyy-MM-dd'),
                description: existing.description,
                categoryName: existing.category?.name || null,
                accountName: existing.account?.name || null,
                type: existing.type,
                status: existing.status
            },
            amount: payload.amount !== undefined ? Number(payload.amount) : Number(existing.amount),
            date: payload.date !== undefined ? asString(payload.date) : format(existing.date, 'yyyy-MM-dd'),
            description: payload.description !== undefined ? asString(payload.description) : existing.description,
            categoryName: previewCategory?.name || null,
            accountName: previewAccount?.name || null,
            type: nextType,
            status: payload.status || existing.status
        };

        return requiresConfirmation('update_transaction', preview);
    }

    const transaction = await updateTransactionWithBalance(id, {
        amount: payload.amount as number | string | undefined,
        date: payload.date as string | undefined,
        description: payload.description as string | undefined,
        categoryId: categoryId as string | undefined,
        accountId: accountId as string | undefined,
        type: nextType as 'INCOME' | 'EXPENSE' | undefined,
        status: payload.status as string | undefined
    });

    return json({
        success: true,
        data: { transaction },
        reply: `Listo. Actualice la transaccion "${transaction.description || 'sin descripcion'}".`
    });
}

async function handleDeleteTransaction(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const sourceType = asString(payload.sourceType).toUpperCase();
    if (sourceType === 'PROJECTION' && !asString(payload.id || payload.transactionId)) {
        return json({
            success: true,
            processed: true,
            reply: 'Esa alerta parece venir de una proyeccion o tarjeta. Necesito el consumo/registro exacto para borrarlo sin tocar algo equivocado.'
        });
    }

    const resolved = await resolveTransactionTarget(user.id, payload, 'delete_transaction', phone);
    if ('response' in resolved) return resolved.response;
    const existing = resolved.transaction;
    const id = existing.id;
    payload.id = id;

    if (shouldUseLatestTransaction({})) {
        // Fallback to the latest transaction created by this user
        const latestTx = await prisma.transaction.findFirst({
            where: { userId: user.id },
            orderBy: { createdAt: 'desc' }
        });
        if (!latestTx) {
            return json({ success: false, error: 'No se encontró ninguna transacción para eliminar.' }, 404);
        }
        payload.id = latestTx!.id;
        payload.id = id; // Ensure ID is saved in session payload
    }

    if (!existing) return json({ success: false, error: 'Transaction not found' }, 404);

    if (!confirmed) {
        await saveAssistantSession(phone, 'delete_transaction', payload);
        return requiresConfirmation('delete_transaction', {
            id,
            amount: Number(existing.amount),
            date: format(existing.date, 'yyyy-MM-dd'),
            description: existing.description,
            category: existing.category?.name || null,
            accountName: existing.account?.name || null,
            type: existing.type
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

async function handleDeleteTransactionsBulk(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const where: Prisma.TransactionWhereInput = { userId: user.id };

    const startDateStr = asString(payload.startDate);
    const endDateStr = asString(payload.endDate);
    const category = asString(payload.category || payload.categoryName);
    const type = asString(payload.type).toUpperCase();
    const query = asString(payload.query || payload.description);

    if (!startDateStr || !endDateStr) {
        return json({ success: false, error: 'startDate and endDate are required' }, 400);
    }

    where.date = {
        gte: new Date(startDateStr),
        lte: (() => {
            const end = new Date(endDateStr);
            end.setHours(23, 59, 59, 999);
            return end;
        })()
    };

    if (category) {
        where.category = {
            name: { contains: category, mode: 'insensitive' }
        };
    }

    if (type === 'INCOME' || type === 'EXPENSE') {
        where.type = type;
    }

    if (query) {
        const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
        if (words.length > 0) {
            where.OR = words.map((word) => ({
                description: { contains: word, mode: 'insensitive' }
            }));
        }
    }

    const transactions = await prisma.transaction.findMany({
        where,
        include: { category: true, account: true },
        orderBy: { date: 'desc' }
    });

    if (transactions.length === 0) {
        return json({
            success: true,
            data: { count: 0 },
            reply: 'No encontré registros para borrar con los filtros especificados.'
        });
    }

    const totalAmount = transactions.reduce((sum, t) => sum + Number(t.amount), 0);
    const expensesCount = transactions.filter(t => t.type === 'EXPENSE').length;
    const incomesCount = transactions.filter(t => t.type === 'INCOME').length;

    const preview = {
        count: transactions.length,
        expensesCount,
        incomesCount,
        totalAmount,
        startDate: startDateStr,
        endDate: endDateStr,
        category,
        type,
        query,
        transactionsPreview: transactions.slice(0, 5).map(t => ({
            id: t.id,
            date: t.date,
            amount: Number(t.amount),
            type: t.type,
            description: t.description,
            category: t.category?.name || null
        }))
    };

    if (!confirmed) {
        await saveAssistantSession(phone, 'delete_transactions_bulk', payload);
        return json({
            success: false,
            requiresConfirmation: true,
            action: 'delete_transactions_bulk',
            preview,
            reply: `Encontré ${transactions.length} registros para borrar.`
        }, 409);
    }

    const count = await deleteTransactionsWithBalance(where);

    return json({
        success: true,
        data: { count },
        reply: `Listo. Eliminé ${count} registros.`
    });
}

// Auxiliares para análisis de dashboard (compatibles con api/dashboard)
const tcLabels: Record<string, string> = {
    COMBUSTIBLE: 'Combustible TC',
    ALIMENTOS: 'Alimentos TC',
    ENTRETENIMIENTO: 'Entretenimiento TC',
    SERVICIOS: 'Servicios TC',
    SEGUROS: 'Seguros TC',
    SALUD: 'Salud TC',
    GASTRONOMIA: 'Gastronomia TC',
    ROPA: 'Ropa TC',
    TRANSPORTE: 'Transporte TC',
    IMPUESTOS: 'Impuestos TC',
    CARGOS: 'Cargos TC',
    STATEMENT: 'Pago Resumen TC',
    OTROS: 'Otros TC'
};

function inRange(date: Date, start: Date, end: Date) {
    return date >= start && date <= end;
}

function projectionDate(projection: CreditCardProjection) {
    return new Date(projection.date);
}

function activeProjections(projections: CreditCardProjection[]) {
    return projections.filter((projection) => projection.status !== 'CANCELLED');
}

function sum(values: number[]) {
    return values.reduce((total, value) => total + value, 0);
}

function calcVariation(current: number, previous: number) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
}

function txsInRange<T extends { date: Date }>(transactions: T[], start: Date, end: Date) {
    return transactions.filter((transaction) => inRange(transaction.date, start, end));
}

function projectionsInRange(projections: CreditCardProjection[], start: Date, end: Date) {
    return projections.filter((projection) => inRange(projectionDate(projection), start, end));
}

function effectiveType(transaction: { type: string; categoryId: string | null }, categoryTypeMap: Map<string, string>) {
    return transaction.categoryId ? categoryTypeMap.get(transaction.categoryId) || transaction.type : transaction.type;
}

function realIncome(transactions: Array<{ type: string; amount: unknown; categoryId: string | null }>, categoryTypeMap: Map<string, string>) {
    return sum(
        transactions
            .filter((transaction) => effectiveType(transaction, categoryTypeMap) === 'INCOME')
            .map((transaction) => Number(transaction.amount))
    );
}

function realExpense(transactions: Array<{ type: string; amount: unknown; status: string; categoryId: string | null }>, categoryTypeMap: Map<string, string>) {
    return sum(
        transactions
            .filter((transaction) => effectiveType(transaction, categoryTypeMap) === 'EXPENSE' && transaction.status !== 'CANCELLED')
            .map((transaction) => Number(transaction.amount))
    );
}

function projectionExpense(projections: CreditCardProjection[]) {
    return sum(activeProjections(projections).map((projection) => projection.amount));
}

function projectionCategoryName(category?: string) {
    const key = category || 'OTROS';
    return tcLabels[key] || `${key} TC`;
}

async function handleDashboardAnalysis(payload: Record<string, unknown>) {
    const user = await getDefaultUser();
    
    const now = new Date();
    const month = asNumber(payload.month) || now.getMonth() + 1;
    const year = asNumber(payload.year) || now.getFullYear();
    const baseDate = new Date(year, month - 1, 15);

    const currentMonthStart = startOfMonth(baseDate);
    const currentMonthEnd = endOfMonth(baseDate);
    const previousMonthStart = startOfMonth(subMonths(baseDate, 1));
    const previousMonthEnd = endOfMonth(subMonths(baseDate, 1));
    const historyStart = startOfMonth(subMonths(baseDate, 5));

    const [transactions, categories, accounts, projections] = await Promise.all([
        prisma.transaction.findMany({
            where: {
                userId: user.id,
                date: { gte: historyStart, lte: currentMonthEnd }
            }
        }),
        prisma.category.findMany({ where: { userId: user.id } }),
        prisma.account.findMany({ where: { userId: user.id } }),
        getCreditCardProjectionsForRange(user.id, historyStart, currentMonthEnd)
    ]);

    const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
    const categoryTypeMap = new Map(categories.map((c) => [c.id, c.type]));

    const currentMonthTxs = txsInRange(transactions, currentMonthStart, currentMonthEnd);
    const previousMonthTxs = txsInRange(transactions, previousMonthStart, previousMonthEnd);

    const currentMonthProjections = projectionsInRange(projections, currentMonthStart, currentMonthEnd);
    const previousMonthProjections = projectionsInRange(projections, previousMonthStart, previousMonthEnd);

    const currentMonthIncome = realIncome(currentMonthTxs, categoryTypeMap);
    const previousMonthIncome = realIncome(previousMonthTxs, categoryTypeMap);

    const currentMonthExpense = realExpense(currentMonthTxs, categoryTypeMap) + projectionExpense(currentMonthProjections);
    const previousMonthExpense = realExpense(previousMonthTxs, categoryTypeMap) + projectionExpense(previousMonthProjections);

    // Accounts balance
    const accountsText = accounts.map(a => `• ${a.name}: ${money(Number(a.balance))}`).join('\n');

    // Category breakdown for current month
    const categoryBreakdownMap = new Map<string, number>();
    for (const transaction of currentMonthTxs) {
        if (effectiveType(transaction, categoryTypeMap) !== 'EXPENSE' || transaction.status === 'CANCELLED') continue;
        const name = categoryMap.get(transaction.categoryId || '') || 'Sin categoria';
        categoryBreakdownMap.set(name, (categoryBreakdownMap.get(name) || 0) + Number(transaction.amount));
    }
    for (const projection of activeProjections(currentMonthProjections)) {
        const name = projectionCategoryName(projection.category);
        categoryBreakdownMap.set(name, (categoryBreakdownMap.get(name) || 0) + projection.amount);
    }

    const categoryBreakdown = Array.from(categoryBreakdownMap.entries())
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

    const topExpensesText = categoryBreakdown.slice(0, 3)
        .map((item, idx) => `${idx + 1}. ${item.name}: ${money(item.amount)}`)
        .join('\n');

    // 6-month history summary
    const historyText = [];
    for (let i = 5; i >= 0; i--) {
        const mStart = startOfMonth(subMonths(baseDate, i));
        const mEnd = endOfMonth(subMonths(baseDate, i));
        const mTxs = txsInRange(transactions, mStart, mEnd);
        const mProjections = projectionsInRange(projections, mStart, mEnd);
        const inc = realIncome(mTxs, categoryTypeMap);
        const exp = realExpense(mTxs, categoryTypeMap) + projectionExpense(mProjections);
        const bal = inc - exp;
        const label = format(mStart, 'MMM yyyy', { locale: es });
        historyText.push(`• ${label}: Ingresos ${money(inc)} | Gastos ${money(exp)} | Saldo ${money(bal)}`);
    }

    const currentLabel = format(baseDate, 'MMMM yyyy', { locale: es });
    const prevLabel = format(subMonths(baseDate, 1), 'MMMM yyyy', { locale: es });

    let reply = `📊 *Análisis de Dashboard (${currentLabel})*\n\n`;
    reply += `💰 *Mes Actual (${currentLabel}):*\n`;
    reply += `• Ingresos: ${money(currentMonthIncome)}\n`;
    reply += `• Gastos: ${money(currentMonthExpense)}\n`;
    reply += `• Balance: ${money(currentMonthIncome - currentMonthExpense)}\n\n`;

    reply += `📉 *Comparación con ${prevLabel}:*\n`;
    reply += `• Variación Ingresos: ${calcVariation(currentMonthIncome, previousMonthIncome).toFixed(1)}%\n`;
    reply += `• Variación Gastos: ${calcVariation(currentMonthExpense, previousMonthExpense).toFixed(1)}%\n\n`;

    if (topExpensesText) {
        reply += `🔺 *Mayores Gastos del Mes:* \n${topExpensesText}\n\n`;
    }

    if (accountsText) {
        reply += `🏦 *Saldos en Cuentas:* \n${accountsText}\n\n`;
    }

    reply += `📅 *Historial de los últimos 6 meses:*\n${historyText.join('\n')}`;

    return json({
        success: true,
        data: {
            currentMonth: { income: currentMonthIncome, expense: currentMonthExpense },
            previousMonth: { income: previousMonthIncome, expense: previousMonthExpense },
            accounts: accounts.map(a => ({ name: a.name, balance: Number(a.balance) })),
            categoryBreakdown,
            history: historyText
        },
        reply
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

async function handlePersonalOverview(payload: Record<string, unknown>) {
    const user = await getDefaultUser();
    const overview = await getPersonalAssistantOverview(user.id, {
        daysAhead: asNumber(payload.daysAhead) || 45,
        daysBack: asNumber(payload.daysBack) || 14
    });

    const todayKey = overview.summary.todayKey;
    const todayEvents = overview.events.filter((item) => assistantDateKey(item.startsAt, overview.timeZone) === todayKey);
    const todayReminders = overview.reminders.filter((item) => assistantDateKey(item.remindAt, overview.timeZone) === todayKey);
    const pendingTasks = overview.tasks.filter((item) => item.status !== 'DONE' && item.status !== 'CANCELLED');
    const nextEvent = overview.events.find((item) => item.status === 'SCHEDULED');
    const nextReminder = overview.reminders.find((item) => item.status === 'PENDING');
    const financialToday = overview.financialAlerts.items.filter((item) => item.daysUntilDue === 0);
    const financialAmountToday = financialToday.reduce((total, item) => total + item.amount, 0);

    const reply = [
        `Para hoy tenes ${overview.summary.eventsToday} evento(s), ${overview.summary.remindersToday} recordatorio(s) y ${overview.summary.tasksPending} tarea(s) pendiente(s)${overview.summary.tasksOverdue ? `, con ${overview.summary.tasksOverdue} vencida(s)` : ''}.`,
        todayEvents.length ? `Agenda: ${todayEvents.slice(0, 3).map((item) => `${assistantDateTime(item.startsAt, overview.timeZone)} ${item.title}`).join('; ')}.` : '',
        todayReminders.length ? `Recordatorios: ${todayReminders.slice(0, 3).map((item) => `${assistantDateTime(item.remindAt, overview.timeZone)} ${item.title}`).join('; ')}.` : '',
        !todayEvents.length && nextEvent ? `Proxima reunion/evento: ${assistantDateTime(nextEvent.startsAt, overview.timeZone)} ${nextEvent.title}.` : '',
        !todayReminders.length && nextReminder ? `Proximo recordatorio: ${assistantDateTime(nextReminder.remindAt, overview.timeZone)} ${nextReminder.title}.` : '',
        pendingTasks.length ? `Tareas: ${pendingTasks.slice(0, 3).map((item) => item.title).join('; ')}.` : '',
        `Finanzas: ${overview.summary.financialDueToday} vencimiento(s) hoy por ${money(financialAmountToday)}${overview.summary.financialOverdue ? ` y ${overview.summary.financialOverdue} atrasado(s)` : ''}.`,
        overview.summary.messagesPending ? `Mensajes pendientes/programados: ${overview.summary.messagesPending}.` : ''
    ].filter(Boolean).join(' ');

    const fallbackReply = [
        'No hay agenda ni recordatorios para hoy.',
        nextEvent ? `Proximo evento: ${assistantDateTime(nextEvent.startsAt, overview.timeZone)} ${nextEvent.title}.` : '',
        nextReminder ? `Proximo recordatorio: ${assistantDateTime(nextReminder.remindAt, overview.timeZone)} ${nextReminder.title}.` : '',
        `Finanzas: ${overview.summary.financialDueToday} vencimiento(s) hoy por ${money(financialAmountToday)}.`
    ].filter(Boolean).join(' ');

    const finalReply = reply.trim() || fallbackReply;

    return json({
        success: true,
        data: overview,
        reply: finalReply
    });
}

function groupedFinancialAlertLines(items: Array<{
    title: string;
    amount: number;
    dueDate: string;
    daysUntilDue: number;
    sourceLabel?: string;
}>) {
    const groups = new Map<string, {
        title: string;
        amount: number;
        dueDates: string[];
        labels: Set<string>;
        items: Array<{
            title: string;
            amount: number;
            dueDate: string;
            daysUntilDue: number;
            sourceLabel?: string;
        }>;
    }>();

    for (const item of items) {
        const key = item.title.trim().toLowerCase();
        const current = groups.get(key) || {
            title: item.title,
            amount: 0,
            dueDates: [],
            labels: new Set<string>(),
            items: []
        };
        current.amount += item.amount;
        current.dueDates.push(item.dueDate);
        if (item.sourceLabel) current.labels.add(item.sourceLabel);
        current.items.push(item);
        groups.set(key, current);
    }

    return Array.from(groups.values()).slice(0, 6).map((group) => {
        const sortedDates = group.dueDates.sort();
        const first = sortedDates[0];
        const last = sortedDates[sortedDates.length - 1];
        const source = group.labels.size ? ` · ${Array.from(group.labels).join(', ')}` : '';
        if (group.items.length === 1) {
            const [item] = group.items;
            const dueLabel = item.daysUntilDue < 0 ? ', vencido' : item.daysUntilDue === 0 ? ', hoy' : '';
            return `- ${item.title}: ${money(item.amount)} (${item.dueDate}${dueLabel})${source}`;
        }
        const range = first === last ? first : `${first} a ${last}`;
        return `- ${group.title}: ${group.items.length} vencimientos por ${money(group.amount)} (${range})${source}`;
    });
}

function groupedFinancialAlertSummary(items: Array<{
    title: string;
    amount: number;
    dueDate: string;
    daysUntilDue: number;
    sourceLabel?: string;
}>) {
    const groups = new Map<string, Array<{
        title: string;
        amount: number;
        dueDate: string;
        daysUntilDue: number;
        sourceLabel?: string;
    }>>();

    for (const item of items) {
        const key = item.title.trim().toLowerCase();
        groups.set(key, [...(groups.get(key) || []), item]);
    }

    const rows = Array.from(groups.values()).slice(0, 6).map((group) => {
        const ordered = group.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        const next = ordered[0];
        const labels = Array.from(new Set(group.map((item) => item.sourceLabel).filter(Boolean)));
        const source = labels.length ? ` - ${labels.join(', ')}` : '';
        if (group.length === 1) {
            const dueLabel = next.daysUntilDue < 0 ? ', vencido' : next.daysUntilDue === 0 ? ', hoy' : '';
            return {
                line: `- ${next.title}: ${money(next.amount)} (${next.dueDate}${dueLabel})${source}`,
                displayAmount: next.amount
            };
        }
        const first = ordered[0].dueDate;
        const last = ordered[ordered.length - 1].dueDate;
        const range = first === last ? first : `${first} a ${last}`;
        return {
            line: `- ${next.title}: proximo vencimiento ${money(next.amount)} (${next.dueDate}; ${group.length} vencimientos en el rango ${range})${source}`,
            displayAmount: next.amount
        };
    });

    return {
        count: rows.length,
        total: rows.reduce((sum, row) => sum + row.displayAmount, 0),
        lines: rows.map((row) => row.line)
    };
}

async function handleSearchPersonalItems(payload: Record<string, unknown>) {
    const user = await getDefaultUser();
    const data = await searchPersonalItems(user.id, payload);
    const count = data.tasks.length + data.reminders.length + data.events.length + data.contacts.length + data.financialAlerts.length;
    const rangeLabel = data.range.startKey
        ? data.range.startKey === data.range.endKey
            ? ` del ${assistantDateShort(`${data.range.startKey}T12:00:00.000Z`)}`
            : ` del ${data.range.startKey} al ${data.range.endKey}`
        : '';
    const financialSummary = groupedFinancialAlertSummary(data.financialAlerts);
    const lines = [
        data.financialAlerts.length ? `Vencimientos financieros${rangeLabel}: ${financialSummary.count} por ${money(financialSummary.total)}.\n${financialSummary.lines.join('\n')}` : '',
        data.reminders.length ? `Recordatorios${rangeLabel}:\n${data.reminders.slice(0, 6).map((item) => `- ${assistantDateTime(item.remindAt)} ${item.title} [${item.status}]`).join('\n')}` : '',
        data.tasks.length ? `Tareas${rangeLabel}:\n${data.tasks.slice(0, 6).map((item) => `- ${item.dueAt ? assistantDateTime(item.dueAt) : 'sin fecha'} ${item.title} [${item.status}]`).join('\n')}` : '',
        data.events.length ? `Agenda${rangeLabel}:\n${data.events.slice(0, 6).map((item) => `- ${assistantDateTime(item.startsAt)} ${item.title} [${item.status}]`).join('\n')}` : '',
        data.contacts.length ? `Contactos:\n${data.contacts.slice(0, 6).map((item) => `- ${item.name}${item.alias ? ` (${item.alias})` : ''}: ...${lastDigits(item.phone)}`).join('\n')}` : ''
    ].filter(Boolean);

    return json({
        success: true,
        data,
        reply: count === 0
            ? 'No encontre items personales con ese criterio.'
            : lines.join('\n\n')
    });
}

function requiresPersonalConfirmation(action: AssistantAction, payload: Record<string, unknown>, phone: string) {
    return saveAssistantSession(phone, action, payload).then(() => json({
        success: false,
        requiresConfirmation: true,
        action,
        preview: personalActionPreview(action, payload),
        reply: 'Necesito confirmacion explicita antes de modificar tu agenda o enviar WhatsApp.'
    }, 409));
}

function hasPayloadValue(payload: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(payload, key);
}

function hasPersonalTargetPayload(payload: Record<string, unknown>) {
    return [
        payload.id,
        payload.taskId,
        payload.reminderId,
        payload.eventId,
        payload.query,
        payload.target,
        payload.targetTitle,
        payload.currentTitle,
        payload.originalTitle,
        payload.title,
        payload.task,
        payload.reminder,
        payload.event
    ].some((value) => Boolean(asString(value)));
}

function personalCandidateLines(candidates: Awaited<ReturnType<typeof findPersonalItemCandidates>>) {
    return candidates.slice(0, 8).map((candidate, index) => {
        const label = candidate.kind === 'task' ? 'tarea' : candidate.kind === 'reminder' ? 'recordatorio' : 'agenda';
        const extra = [
            candidate.description ? `descripcion: ${candidate.description}` : '',
            candidate.location ? `lugar: ${candidate.location}` : '',
            candidate.participants ? `con: ${candidate.participants}` : ''
        ].filter(Boolean).join(', ');
        return `${index + 1}) ${label} ${compactDate(candidate.date)}: ${candidate.title} [${candidate.status}]${extra ? ` (${extra})` : ''}`;
    });
}

function actionForPersonalKind(kind: 'task' | 'reminder' | 'event'): AssistantAction {
    if (kind === 'task') return 'update_personal_task';
    if (kind === 'reminder') return 'update_personal_reminder';
    return 'update_personal_event';
}

function idPayloadForPersonalKind(kind: 'task' | 'reminder' | 'event', id: string) {
    if (kind === 'task') return { id, taskId: id };
    if (kind === 'reminder') return { id, reminderId: id };
    return { id, eventId: id };
}

function selectedOptionFromText(text: string) {
    const normalized = text.trim().toLowerCase();
    const direct = normalized.match(/^(?:opcion\s*)?(\d+)$/);
    if (direct) return Number(direct[1]);
    const words: Record<string, number> = {
        primera: 1,
        primero: 1,
        segunda: 2,
        segundo: 2,
        tercera: 3,
        tercero: 3,
        cuarta: 4,
        cuarto: 4,
        quinta: 5,
        quinto: 5
    };
    const word = normalized.match(/^la\s+(\w+)|^el\s+(\w+)/);
    if (word) return words[word[1] || word[2]] || null;
    return null;
}

function selectionPayloadFromSession(sessionPayload: Record<string, unknown>, option: number) {
    const candidates = Array.isArray(sessionPayload.candidates)
        ? sessionPayload.candidates as Array<Record<string, unknown>>
        : [];
    const selected = candidates.find((candidate) => Number(candidate.option) === option) || candidates[option - 1];
    if (!selected) return null;

    const action = asString(selected.action || sessionPayload.action) as AssistantAction;
    const originalPayload = (sessionPayload.originalPayload && typeof sessionPayload.originalPayload === 'object')
        ? sessionPayload.originalPayload as Record<string, unknown>
        : {};
    const payload = {
        ...originalPayload,
        id: selected.id,
        transactionId: selected.id
    };

    const kind = asString(selected.kind) as 'task' | 'reminder' | 'event';
    if (kind === 'task' || kind === 'reminder' || kind === 'event') {
        Object.assign(payload, idPayloadForPersonalKind(kind, asString(selected.id)));
    }

    return { action, payload, selected };
}

async function findPersonalCandidatesAcrossKinds(userId: string, payload: Record<string, unknown>) {
    const [tasks, reminders, events] = await Promise.all([
        findPersonalItemCandidates(userId, 'task', payload),
        findPersonalItemCandidates(userId, 'reminder', payload),
        findPersonalItemCandidates(userId, 'event', payload)
    ]);
    return [...tasks, ...reminders, ...events]
        .sort((a, b) => b.score - a.score || Number(a.date || 0) - Number(b.date || 0))
        .slice(0, 12);
}

async function resolvePersonalTarget(
    kind: 'task' | 'reminder' | 'event',
    action: AssistantAction,
    payload: Record<string, unknown>,
    phone: string
) {
    const user = await getDefaultUser();
    const hasExplicitTarget = hasPersonalTargetPayload(payload);
    const shouldSearchAcrossKinds = asBoolean(payload.searchAllPersonalTypes) || action === 'update_personal_item' || !hasExplicitTarget;
    const candidates = shouldSearchAcrossKinds
        ? await findPersonalCandidatesAcrossKinds(user.id, payload)
        : await findPersonalItemCandidates(user.id, kind, payload);
    if (candidates.length === 0) {
        return {
            response: json({
                success: true,
                processed: true,
                needsSelection: true,
                reply: 'No encontre un item claro para actualizar. Pasame titulo, fecha o algun detalle mas.'
            })
        };
    }
    if (candidates.length === 1 && hasExplicitTarget) {
        const [candidate] = candidates;
        Object.assign(payload, idPayloadForPersonalKind(candidate.kind, candidate.id));
        return { candidate };
    }

    const selectionPayload = {
        action,
        originalPayload: payload,
        candidates: candidates.slice(0, 8).map((candidate, index) => ({
            option: index + 1,
            id: candidate.id,
            kind: candidate.kind,
            action: actionForPersonalKind(candidate.kind),
            title: candidate.title,
            date: candidate.date,
            status: candidate.status,
            description: candidate.description,
            location: candidate.location || null,
            participants: candidate.participants || null
        }))
    };
    await saveAssistantSession(phone, `select_${action}`, selectionPayload);
    return {
        response: json({
            success: true,
            processed: true,
            needsSelection: true,
            candidates: selectionPayload.candidates,
            reply: `Encontre ${candidates.length} opciones posibles. Decime el numero o dame mas detalle de cual queres usar:\n${personalCandidateLines(candidates).join('\n')}`
        })
    };
}

function personalUpdatePreview(action: AssistantAction, payload: Record<string, unknown>, candidate: Awaited<ReturnType<typeof findPersonalItemCandidates>>[number]) {
    return {
        action,
        id: candidate.id,
        previous: {
            title: candidate.title,
            description: candidate.description,
            date: candidate.date,
            status: candidate.status,
            location: candidate.location || null,
            participants: candidate.participants || null
        },
        title: hasPayloadValue(payload, 'title') ? asString(payload.title) : candidate.title,
        description: hasPayloadValue(payload, 'description') ? asString(payload.description) || null : candidate.description,
        date: asString(payload.remindAt || payload.dueAt || payload.startsAt || payload.date || payload.datetime) || candidate.date,
        priority: hasPayloadValue(payload, 'priority') ? asString(payload.priority).toUpperCase() : undefined,
        status: hasPayloadValue(payload, 'status') ? asString(payload.status).toUpperCase() : candidate.status,
        location: hasPayloadValue(payload, 'location') ? asString(payload.location) || null : candidate.location || null,
        participants: hasPayloadValue(payload, 'participants') ? asString(payload.participants) || null : candidate.participants || null
    };
}

async function handleCreatePersonalContact(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    if (!confirmed) return requiresPersonalConfirmation('create_personal_contact', payload, phone);
    const user = await getDefaultUser();
    const contact = await createPersonalContact(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { contact },
        reply: `Listo. Guarde el contacto ${contact.name}.`
    });
}

async function handleCreatePersonalReminder(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    if (!confirmed) return requiresPersonalConfirmation('create_personal_reminder', payload, phone);
    const user = await getDefaultUser();
    const reminder = await createPersonalReminder(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { reminder },
        reply: `Listo. Cree el recordatorio "${reminder.title}".`
    });
}

async function handleCreatePersonalTask(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    if (!confirmed) return requiresPersonalConfirmation('create_personal_task', payload, phone);
    const user = await getDefaultUser();
    const task = await createPersonalTask(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { task },
        reply: `Listo. Cree la tarea "${task.title}".`
    });
}

async function handleCreatePersonalEvent(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    if (!confirmed) return requiresPersonalConfirmation('create_personal_event', payload, phone);
    const user = await getDefaultUser();
    const event = await createPersonalEvent(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { event },
        reply: `Listo. Agende "${event.title}".`
    });
}

async function handleCreateOutboundMessage(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const explicitPhone = phoneFromPayload(payload);
    const contact = await findPersonalContact(user.id, payload);
    const name = asString(payload.contactName || payload.name || payload.to) || 'ese contacto';

    if (!explicitPhone && !contact?.phone) {
        return json({
            success: true,
            processed: true,
            reply: `No tengo el telefono de ${name} en la agenda de la app. Pasame el numero o agregalo como contacto y lo preparo.`
        });
    }

    if (!confirmed) {
        return requiresPersonalConfirmation('create_outbound_message', payload, phone);
    }
    const message = await createOutboundMessage(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { message },
        reply: message.scheduledAt
            ? `Listo. Deje programado el WhatsApp para ${message.contactName || message.phone}.`
            : `Listo. Deje preparado el WhatsApp para ${message.contactName || message.phone}.`
    });
}

async function handleSendOutboundMessage(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const explicitPhone = phoneFromPayload(payload);
    const contact = await findPersonalContact(user.id, payload);
    const name = asString(payload.contactName || payload.name || payload.to) || 'ese contacto';

    if (!explicitPhone && !contact?.phone) {
        return json({
            success: true,
            processed: true,
            reply: `No tengo el telefono de ${name} en la agenda de la app. Pasame el numero o agregalo como contacto y lo envio.`
        });
    }

    if (!confirmed) {
        return requiresPersonalConfirmation('send_outbound_message', payload, phone);
    }
    const message = await sendOutboundMessageNow(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { message },
        reply: `Listo. Envie el WhatsApp a ${message.contactName || message.phone}${message.phone ? ` (numero terminado en ${lastDigits(message.phone)})` : ''}.`
    });
}

async function handleUpdatePersonalTask(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const resolved = await resolvePersonalTarget('task', 'update_personal_task', payload, phone);
    if ('response' in resolved) return resolved.response;
    if (!confirmed) {
        await saveAssistantSession(phone, 'update_personal_task', payload);
        return json({
            success: false,
            requiresConfirmation: true,
            action: 'update_personal_task',
            preview: personalUpdatePreview('update_personal_task', payload, resolved.candidate),
            reply: 'Necesito confirmacion explicita antes de modificar tu tarea.'
        }, 409);
    }
    const task = await updatePersonalTask(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { task },
        reply: `Listo. Actualice la tarea "${task.title}".`
    });
}

async function handleUpdatePersonalReminder(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const resolved = await resolvePersonalTarget('reminder', 'update_personal_reminder', payload, phone);
    if ('response' in resolved) return resolved.response;
    if (!confirmed) {
        await saveAssistantSession(phone, 'update_personal_reminder', payload);
        return json({
            success: false,
            requiresConfirmation: true,
            action: 'update_personal_reminder',
            preview: personalUpdatePreview('update_personal_reminder', payload, resolved.candidate),
            reply: 'Necesito confirmacion explicita antes de modificar tu recordatorio.'
        }, 409);
    }
    const reminder = await updatePersonalReminder(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { reminder },
        reply: `Listo. Actualice el recordatorio "${reminder.title}".`
    });
}

async function handleUpdatePersonalEvent(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const user = await getDefaultUser();
    const resolved = await resolvePersonalTarget('event', 'update_personal_event', payload, phone);
    if ('response' in resolved) return resolved.response;
    if (!confirmed) {
        await saveAssistantSession(phone, 'update_personal_event', payload);
        return json({
            success: false,
            requiresConfirmation: true,
            action: 'update_personal_event',
            preview: personalUpdatePreview('update_personal_event', payload, resolved.candidate),
            reply: 'Necesito confirmacion explicita antes de modificar tu agenda.'
        }, 409);
    }
    const event = await updatePersonalEvent(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { event },
        reply: `Listo. Actualice la agenda "${event.title}".`
    });
}

async function handleUpdatePersonalItem(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    const resolved = await resolvePersonalTarget('event', 'update_personal_item', {
        ...payload,
        searchAllPersonalTypes: true
    }, phone);
    if ('response' in resolved) return resolved.response;

    Object.assign(payload, idPayloadForPersonalKind(resolved.candidate.kind, resolved.candidate.id));
    if (resolved.candidate.kind === 'task') {
        return handleUpdatePersonalTask(payload, confirmed, phone);
    }
    if (resolved.candidate.kind === 'reminder') {
        return handleUpdatePersonalReminder(payload, confirmed, phone);
    }
    return handleUpdatePersonalEvent(payload, confirmed, phone);
}

async function handlePostponePersonalReminder(payload: Record<string, unknown>, confirmed: boolean, phone: string) {
    if (!confirmed) return requiresPersonalConfirmation('postpone_personal_reminder', payload, phone);
    const user = await getDefaultUser();
    const reminder = await postponePersonalReminder(user.id, payload, 'WHATSAPP');
    return json({
        success: true,
        data: { reminder },
        reply: `Listo. Pospuse el recordatorio "${reminder.title}".`
    });
}

async function saveAssistantSession(phone: string, action: string, payload: Record<string, unknown>) {
    if (!phone) return;
    await prisma.assistantSession.upsert({
        where: { phone },
        update: { action, payload: payload as Prisma.JsonObject, createdAt: new Date() },
        create: { phone, action, payload: payload as Prisma.JsonObject }
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
    if (assistantSessionExpired(session.createdAt)) {
        await prisma.assistantSession.delete({ where: { id: session.id } });
        return json({ success: true, processed: false });
    }

    const text = asString(payload.text).trim().toLowerCase();
    const yesWords = ['si', 'sí', 'confirmo', 'confirmar', 'ok', 'dale', 'guardar', 'cargar'];
    const noWords = ['no', 'cancelar', 'cancela', 'anular', 'descartar'];

    const selectedOption = selectedOptionFromText(text);
    if (session.action.startsWith('select_') && selectedOption) {
        const selection = selectionPayloadFromSession(session.payload as Record<string, unknown>, selectedOption);
        if (!selection || !selection.action) {
            return json({
                success: true,
                processed: true,
                reply: 'No encontre esa opcion. Respondeme con uno de los numeros de la lista.'
            });
        }

        let response;
        try {
            await appendToAssistantHistory(phone, 'user', text);
            const executeNow = ['update_personal_task', 'update_personal_reminder', 'update_personal_event', 'update_personal_item']
                .includes(selection.action);

            if (selection.action === 'update_transaction') {
                response = await handleUpdateTransaction(selection.payload, false, phone);
            } else if (selection.action === 'delete_transaction') {
                response = await handleDeleteTransaction(selection.payload, false, phone);
            } else if (selection.action === 'update_personal_task') {
                response = await handleUpdatePersonalTask(selection.payload, executeNow, phone);
            } else if (selection.action === 'update_personal_reminder') {
                response = await handleUpdatePersonalReminder(selection.payload, executeNow, phone);
            } else if (selection.action === 'update_personal_event') {
                response = await handleUpdatePersonalEvent(selection.payload, executeNow, phone);
            } else if (selection.action === 'update_personal_item') {
                response = await handleUpdatePersonalItem(selection.payload, executeNow, phone);
            } else {
                return json({ success: true, processed: false });
            }

            if (!response) {
                return json({ success: true, processed: false });
            }

            const resData = await response.json();
            if (response.ok && resData.success !== false) {
                await prisma.assistantSession.delete({ where: { id: session.id } }).catch(() => undefined);
                await appendToAssistantHistory(phone, 'assistant', resData.reply || 'Listo. Accion aplicada.');
                return json({
                    success: true,
                    processed: true,
                    reply: resData.reply || 'Listo. Accion aplicada.'
                });
            }

            if (response.status === 409 || resData.requiresConfirmation === true) {
                await appendToAssistantHistory(phone, 'assistant', resData.reply || 'Necesito confirmacion para aplicar el cambio.');
                return json({
                    success: true,
                    processed: true,
                    reply: resData.reply || 'Necesito confirmacion para aplicar el cambio.'
                });
            }

            await prisma.assistantSession.delete({ where: { id: session.id } }).catch(() => undefined);
            const errorReply = `Error al procesar la opcion: ${resData.error || resData.reply || 'No se pudo realizar la accion.'}`;
            await appendToAssistantHistory(phone, 'assistant', errorReply);
            return json({
                success: true,
                processed: true,
                reply: errorReply
            });
        } catch (error) {
            console.error('Error executing selected action:', error);
            return json({ success: false, error: errorMessage(error) }, 500);
        }
    }

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
            } else if (session.action === 'delete_transactions_bulk') {
                response = await handleDeleteTransactionsBulk(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'create_personal_contact') {
                response = await handleCreatePersonalContact(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'create_personal_reminder') {
                response = await handleCreatePersonalReminder(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'create_personal_task') {
                response = await handleCreatePersonalTask(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'create_personal_event') {
                response = await handleCreatePersonalEvent(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'create_outbound_message') {
                response = await handleCreateOutboundMessage(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'send_outbound_message') {
                response = await handleSendOutboundMessage(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'update_personal_task') {
                response = await handleUpdatePersonalTask(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'update_personal_reminder') {
                response = await handleUpdatePersonalReminder(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'update_personal_event') {
                response = await handleUpdatePersonalEvent(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'update_personal_item') {
                response = await handleUpdatePersonalItem(session.payload as Record<string, unknown>, true, phone);
            } else if (session.action === 'postpone_personal_reminder') {
                response = await handlePostponePersonalReminder(session.payload as Record<string, unknown>, true, phone);
            } else {
                await prisma.assistantSession.delete({ where: { id: session.id } });
                return json({ success: true, processed: false });
            }

            if (!response) {
                await prisma.assistantSession.delete({ where: { id: session.id } });
                return json({ success: true, processed: false });
            }

            const resData = await response.json();
            
            if (!response.ok || resData.success === false) {
                await prisma.assistantSession.delete({ where: { id: session.id } });
                const errorReply = `Error al procesar la confirmación: ${resData.error || 'No se pudo realizar la acción.'}`;
                await appendToAssistantHistory(phone, 'assistant', errorReply);
                return json({
                    success: true,
                    processed: true,
                    reply: errorReply
                });
            }

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
            case 'delete_transactions_bulk':
                return handleDeleteTransactionsBulk(payload, body.confirmed === true, sourcePhone);
            case 'dashboard_analysis':
                return handleDashboardAnalysis(payload);
            case 'credit_cards':
                return handleCreditCards();
            case 'personal_overview':
                return handlePersonalOverview(payload);
            case 'search_personal_items':
                return handleSearchPersonalItems(payload);
            case 'create_personal_contact':
                return handleCreatePersonalContact(payload, body.confirmed === true, sourcePhone);
            case 'create_personal_reminder':
                return handleCreatePersonalReminder(payload, body.confirmed === true, sourcePhone);
            case 'create_personal_task':
                return handleCreatePersonalTask(payload, body.confirmed === true, sourcePhone);
            case 'create_personal_event':
                return handleCreatePersonalEvent(payload, body.confirmed === true, sourcePhone);
            case 'create_outbound_message':
                return handleCreateOutboundMessage(payload, body.confirmed === true, sourcePhone);
            case 'send_outbound_message':
                return handleSendOutboundMessage(payload, body.confirmed === true, sourcePhone);
            case 'update_personal_task':
                return handleUpdatePersonalTask(payload, body.confirmed === true, sourcePhone);
            case 'update_personal_reminder':
                return handleUpdatePersonalReminder(payload, body.confirmed === true, sourcePhone);
            case 'update_personal_event':
                return handleUpdatePersonalEvent(payload, body.confirmed === true, sourcePhone);
            case 'update_personal_item':
                return handleUpdatePersonalItem(payload, body.confirmed === true, sourcePhone);
            case 'postpone_personal_reminder':
                return handlePostponePersonalReminder(payload, body.confirmed === true, sourcePhone);
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
