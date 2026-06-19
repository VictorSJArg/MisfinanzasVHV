import { addMonths, endOfMonth, format } from 'date-fns';
import { prisma } from '@/lib/prisma';

export interface CreditCardProjection {
  date: string;
  amount: number;
  description: string;
  type: string;
  category?: string;
  status?: string;
  referenceId?: string;
  cardName?: string;
}

interface VirtualCardItem {
  id: string;
  statementId: string;
  description: string;
  amount: number;
  amountUSD: number;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  itemType: string;
  isRecurring: boolean;
  category: string;
  includeInProjection: boolean;
  projectedAmount: null;
  observations: null;
  dueDate: string;
  isVirtual: true;
  date: string;
}

export async function getCreditCardProjectionsForRange(userId: string, start: Date, end: Date): Promise<CreditCardProjection[]> {
  const projections: CreditCardProjection[] = [];

  const [statuses, cards, overridesData] = await Promise.all([
    prisma.projectionStatus.findMany({
      where: {
        date: { gte: start, lte: end }
      }
    }),
    prisma.creditCard.findMany({
      where: { userId },
      include: {
        statements: {
          orderBy: { dueDate: 'desc' },
          take: 24,
          include: { items: true }
        }
      }
    }),
    prisma.projectionMonthlyOverride.findMany()
  ]);

  const statusMap = new Map(statuses.map((status) => [`${status.referenceId}-${status.date.toISOString()}`, status.status]));
  const monthlyOverrides = new Map(overridesData.map((override) => [`${override.itemId}-${override.yearMonth}`, Number(override.amount)]));

  for (const card of cards) {
    if (card.statements.length === 0) continue;

    const latestStatement = card.statements[0];

    // Inject virtual items (new monthly card transactions from Transaction table)
    const virtualItems = await getVirtualItemsForCard(userId, card);

    for (let i = 0; i < card.statements.length; i++) {
      const currentStmt = card.statements[i];
      const prevStmt = i + 1 < card.statements.length ? card.statements[i + 1] : null;
      const currentStmtItems = currentStmt.id === latestStatement.id ? [...currentStmt.items, ...virtualItems] : currentStmt.items;

      if (!prevStmt) continue;

      for (const prevItem of prevStmt.items) {
        if (!prevItem.isRecurring && (!prevItem.installmentTotal || prevItem.installmentCurrent === prevItem.installmentTotal)) {
          continue;
        }

        const cleanPrev = prevItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();
        const existsInCurrent = currentStmtItems.some((currItem) => {
          const cleanCurr = currItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();
          const descMatch = cleanCurr.includes(cleanPrev) || cleanPrev.includes(cleanCurr);

          if (prevItem.installmentCurrent && currItem.installmentCurrent) {
            return descMatch && currItem.installmentCurrent === prevItem.installmentCurrent + 1;
          }

          return descMatch;
        });

        if (existsInCurrent) continue;

        const stmtDate = new Date(currentStmt.dueDate);
        if (stmtDate >= start && stmtDate <= end) {
          const dateStr = currentStmt.dueDate.toISOString();
          const baseAmount = prevItem.projectedAmount !== null && prevItem.projectedAmount !== undefined
            ? Number(prevItem.projectedAmount)
            : Number(prevItem.amount);

          projections.push({
            date: dateStr,
            amount: baseAmount,
            description: `(Est.) ${prevItem.description}`,
            type: 'RECURRING',
            category: prevItem.category || 'OTROS',
            status: 'PENDING',
            referenceId: `ghost-${prevItem.id}-${currentStmt.id}`,
            cardName: card.name
          });
        }

        if (i === 0) {
          for (let k = 1; k <= 12; k++) {
            const futureDate = endOfMonth(addMonths(currentStmt.dueDate, k));
            if (futureDate < start || futureDate > end) continue;

            const baseAmount = prevItem.projectedAmount !== null && prevItem.projectedAmount !== undefined
              ? Number(prevItem.projectedAmount)
              : Number(prevItem.amount);

            projections.push({
              date: futureDate.toISOString(),
              amount: baseAmount,
              description: `${prevItem.description} (recurrente)`,
              type: 'RECURRING',
              category: prevItem.category || 'OTROS',
              status: 'PENDING',
              referenceId: `ghost-${prevItem.id}-future`,
              cardName: card.name
            });
          }
        }
      }
    }

    for (const statement of card.statements) {
      const isLatest = statement.id === latestStatement.id;
      const statementItems = isLatest ? [...statement.items, ...virtualItems] : statement.items;

      if (statement.dueDate < start && !isLatest) continue;
      if (statement.dueDate > end && !isLatest) continue;

      for (const item of statementItems) {
        if (item.includeInProjection === false) continue;

        const baseAmount = item.projectedAmount !== null && item.projectedAmount !== undefined
          ? Number(item.projectedAmount)
          : Number(item.amount);

        // Handle virtual items (new monthly card transactions)
        const virtualItem = item as typeof item & { dueDate?: string; isVirtual?: boolean };
        const isVirtual = item.id.startsWith('virtual-') || virtualItem.isVirtual === true;
        if (isVirtual) {
          const itemDueDate = virtualItem.dueDate ? new Date(virtualItem.dueDate) : addMonths(statement.dueDate, 1);
          if (itemDueDate >= start && itemDueDate <= end) {
            projections.push({
              date: itemDueDate.toISOString(),
              amount: baseAmount,
              description: item.description,
              type: 'PURCHASE',
              category: item.category || 'OTROS',
              status: 'PENDING',
              referenceId: item.id,
              cardName: card.name
            });
          }
          continue; // Skip the normal statement due date projection
        }

        if (statement.dueDate >= start && statement.dueDate <= end) {
          const dateStr = statement.dueDate.toISOString();
          const yearMonth = format(statement.dueDate, 'yyyy-MM');
          const overrideAmount = monthlyOverrides.get(`${item.id}-${yearMonth}`);
          const finalAmount = overrideAmount !== undefined ? overrideAmount : Number(item.amount);

          projections.push({
            date: dateStr,
            amount: finalAmount,
            description: item.description,
            type: 'PURCHASE',
            category: item.category || 'OTROS',
            status: statusMap.get(`${item.id}-${dateStr}`) || 'PENDING',
            referenceId: item.id,
            cardName: card.name
          });
        }

        if (!isLatest) continue;

        if (item.isRecurring) {
          for (let i = 1; i <= 12; i++) {
            const futureDate = endOfMonth(addMonths(statement.dueDate, i));
            if (futureDate < start || futureDate > end) continue;

            const dateStr = futureDate.toISOString();
            const yearMonth = format(futureDate, 'yyyy-MM');
            const overrideAmount = monthlyOverrides.get(`${item.id}-${yearMonth}`);
            const finalAmount = overrideAmount !== undefined ? overrideAmount : baseAmount;

            projections.push({
              date: dateStr,
              amount: finalAmount,
              description: `${item.description} (recurrente)`,
              type: 'RECURRING',
              category: item.category || 'OTROS',
              status: statusMap.get(`${item.id}-${dateStr}`) || 'PENDING',
              referenceId: item.id,
              cardName: card.name
            });
          }
        } else if (item.installmentCurrent && item.installmentTotal) {
          const remaining = item.installmentTotal - item.installmentCurrent;

          for (let i = 1; i <= remaining; i++) {
            const futureDate = endOfMonth(addMonths(statement.dueDate, i));
            if (futureDate < start || futureDate > end) continue;

            const dateStr = futureDate.toISOString();
            const yearMonth = format(futureDate, 'yyyy-MM');
            const overrideAmount = monthlyOverrides.get(`${item.id}-${yearMonth}`);
            const finalAmount = overrideAmount !== undefined ? overrideAmount : baseAmount;

            projections.push({
              date: dateStr,
              amount: finalAmount,
              description: `${item.description} (${item.installmentCurrent + i}/${item.installmentTotal})`,
              type: 'INSTALLMENT',
              category: item.category || 'OTROS',
              status: statusMap.get(`${item.id}-${dateStr}`) || 'PENDING',
              referenceId: item.id,
              cardName: card.name
            });
          }
        }
      }
    }
  }

  return projections;
}

export function getDueDateForTransaction(txDate: Date, latestStatement: { closingDate: Date; dueDate: Date }): Date {
  const tx = new Date(txDate);
  const closing = new Date(latestStatement.closingDate);
  const due = new Date(latestStatement.dueDate);

  let monthsToAdd = 1;
  let targetClosing = new Date(closing);
  targetClosing.setMonth(targetClosing.getMonth() + 1);

  while (tx > targetClosing) {
    monthsToAdd++;
    targetClosing = new Date(closing);
    targetClosing.setMonth(targetClosing.getMonth() + monthsToAdd);
  }

  return endOfMonth(addMonths(due, monthsToAdd));
}

export async function getAccountIdForCard(userId: string, card: { name: string; bank: string }): Promise<string | null> {
  const accounts = await prisma.account.findMany({
    where: { userId, type: 'CREDIT' }
  });
  const cardNameLower = card.name.toLowerCase();
  const cardBankLower = card.bank.toLowerCase();

  const match = accounts.find(acc => {
    const accNameLower = acc.name.toLowerCase();
    return accNameLower.includes(cardNameLower) || cardNameLower.includes(accNameLower) ||
           accNameLower.includes(cardBankLower) || cardBankLower.includes(accNameLower);
  });

  if (match) return match.id;

  // Create it dynamically if no matching account is found
  try {
    const accountName = `${card.name} ${card.bank}`;
    const newAccount = await prisma.account.create({
      data: {
        name: accountName,
        type: 'CREDIT',
        balance: 0,
        userId
      }
    });
    console.log(`Created CREDIT account "${accountName}" dynamically for card.`);
    return newAccount.id;
  } catch (error) {
    console.error('Error creating CREDIT account dynamically:', error);
    return null;
  }
}

export async function getVirtualItemsForCard(
  userId: string,
  card: { id: string; name: string; bank: string; statements: Array<{ id: string; closingDate: Date; dueDate: Date }> }
): Promise<VirtualCardItem[]> {
  if (card.statements.length === 0) return [];
  const latestStatement = card.statements[0];

  const accountId = await getAccountIdForCard(userId, card);
  if (!accountId) return [];

  const transactions = await prisma.transaction.findMany({
    where: {
      userId,
      accountId,
      type: 'EXPENSE',
      status: { not: 'CANCELLED' },
      date: { gt: latestStatement.closingDate }
    },
    orderBy: { date: 'asc' }
  });

  return transactions.map((tx): VirtualCardItem => {
    const dueDate = getDueDateForTransaction(tx.date, latestStatement);
    return {
      id: `virtual-item-${tx.id}`,
      statementId: latestStatement.id,
      description: tx.description || 'Gasto Tarjeta',
      amount: Number(tx.amount),
      amountUSD: 0,
      installmentCurrent: null,
      installmentTotal: null,
      itemType: 'PURCHASE',
      isRecurring: false,
      category: 'NUEVOS_GASTOS',
      includeInProjection: true,
      projectedAmount: null,
      observations: null,
      dueDate: dueDate.toISOString(),
      isVirtual: true,
      date: tx.date.toISOString()
    };
  });
}
