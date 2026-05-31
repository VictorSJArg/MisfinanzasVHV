import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

interface TransactionInput {
  amount?: number | string;
  date?: string | Date;
  type?: TransactionType;
  description?: string | null;
  categoryId?: string | null;
  accountId?: string;
  userId?: string;
  status?: string;
}

export function balanceMultiplier(type: string) {
  return type === 'INCOME' ? 1 : -1;
}

function parseAmount(value: number | string | undefined, fieldName = 'amount') {
  if (value === undefined || value === null || value === '') return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
  return amount;
}

function parseDate(value: string | Date | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('date must be a valid date');
  }
  return date;
}

export async function createTransactionWithBalance(input: Required<Pick<TransactionInput, 'amount' | 'date' | 'type' | 'accountId' | 'userId'>> & TransactionInput) {
  const amount = parseAmount(input.amount);
  const date = parseDate(input.date);

  if (amount === undefined || amount <= 0) {
    throw new Error('amount must be greater than zero');
  }
  if (!date) {
    throw new Error('date is required');
  }

  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.create({
      data: {
        amount,
        date,
        type: input.type,
        description: input.description || null,
        categoryId: input.categoryId || null,
        accountId: input.accountId,
        userId: input.userId,
        status: input.status || undefined
      }
    });

    await tx.account.update({
      where: { id: input.accountId },
      data: { balance: { increment: amount * balanceMultiplier(input.type) } }
    });

    return transaction;
  });
}

export async function updateTransactionWithBalance(id: string, input: TransactionInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Transaction not found');
    }

    const nextAmount = parseAmount(input.amount) ?? Number(existing.amount);
    const nextDate = parseDate(input.date);
    const nextType = input.type || existing.type;
    const accountIdUpdate = input.accountId || undefined;
    const nextAccountId = accountIdUpdate || existing.accountId;

    const affectsBalance =
      nextAmount !== Number(existing.amount) ||
      nextType !== existing.type ||
      nextAccountId !== existing.accountId;

    if (affectsBalance) {
      await tx.account.update({
        where: { id: existing.accountId },
        data: { balance: { increment: Number(existing.amount) * -balanceMultiplier(existing.type) } }
      });

      await tx.account.update({
        where: { id: nextAccountId },
        data: { balance: { increment: nextAmount * balanceMultiplier(nextType) } }
      });
    }

    return tx.transaction.update({
      where: { id },
      data: {
        amount: input.amount !== undefined ? nextAmount : undefined,
        date: nextDate,
        type: input.type,
        description: input.description !== undefined ? input.description : undefined,
        categoryId: input.categoryId !== undefined ? input.categoryId : undefined,
        accountId: accountIdUpdate,
        status: input.status
      }
    });
  });
}

export async function deleteTransactionWithBalance(id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transaction.findUnique({ where: { id } });
    if (!existing) {
      throw new Error('Transaction not found');
    }

    await tx.account.update({
      where: { id: existing.accountId },
      data: { balance: { increment: Number(existing.amount) * -balanceMultiplier(existing.type) } }
    });

    await tx.transaction.delete({ where: { id } });
    return existing;
  });
}

export async function deleteTransactionsWithBalance(where: Prisma.TransactionWhereInput) {
  return prisma.$transaction(async (tx) => {
    const transactions = await tx.transaction.findMany({ where });
    const balanceDeltas = new Map<string, number>();

    for (const transaction of transactions) {
      const delta = Number(transaction.amount) * -balanceMultiplier(transaction.type);
      balanceDeltas.set(transaction.accountId, (balanceDeltas.get(transaction.accountId) || 0) + delta);
    }

    for (const [accountId, delta] of balanceDeltas) {
      await tx.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } }
      });
    }

    const result = await tx.transaction.deleteMany({ where });
    return result.count;
  });
}
