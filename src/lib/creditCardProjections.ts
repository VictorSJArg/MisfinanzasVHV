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

    for (let i = 0; i < card.statements.length; i++) {
      const currentStmt = card.statements[i];
      const prevStmt = i + 1 < card.statements.length ? card.statements[i + 1] : null;

      if (!prevStmt) continue;

      for (const prevItem of prevStmt.items) {
        if (!prevItem.isRecurring && (!prevItem.installmentTotal || prevItem.installmentCurrent === prevItem.installmentTotal)) {
          continue;
        }

        const cleanPrev = prevItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();
        const existsInCurrent = currentStmt.items.some((currItem) => {
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
            referenceId: `ghost-${prevItem.id}-${currentStmt.id}`
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
              referenceId: `ghost-${prevItem.id}-future`
            });
          }
        }
      }
    }

    for (const statement of card.statements) {
      const isLatest = statement.id === latestStatement.id;

      if (statement.dueDate < start && !isLatest) continue;
      if (statement.dueDate > end && !isLatest) continue;

      for (const item of statement.items) {
        if (item.includeInProjection === false) continue;

        const baseAmount = item.projectedAmount !== null && item.projectedAmount !== undefined
          ? Number(item.projectedAmount)
          : Number(item.amount);

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
            referenceId: item.id
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
              referenceId: item.id
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
              referenceId: item.id
            });
          }
        }
      }
    }
  }

  return projections;
}
