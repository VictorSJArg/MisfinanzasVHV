import { prisma } from '@/lib/prisma';

const AUTO_PAY_TIMEZONE = 'America/Argentina/Buenos_Aires';

function currentDateKey(timeZone = AUTO_PAY_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';

  return `${year}-${month}-${day}`;
}

function endOfCurrentDayUtc() {
  return new Date(`${currentDateKey()}T23:59:59.999Z`);
}

function normalizeDescription(description: string | null | undefined) {
  return description?.trim() || '';
}

export async function autoPayReachedExcludedExpenseTransactions(userId: string, options: {
  categoryId?: string;
  description?: string;
} = {}) {
  const [exclusions, expenseCategories] = await Promise.all([
    prisma.alertExclusion.findMany({
      where: {
        userId,
        categoryId: options.categoryId,
        description: options.description
      },
      select: {
        categoryId: true,
        description: true
      }
    }),
    prisma.category.findMany({
      where: {
        userId,
        type: 'EXPENSE',
        id: options.categoryId
      },
      select: { id: true }
    })
  ]);

  const expenseCategoryIds = new Set(expenseCategories.map((category) => category.id));
  const relevantExclusions = exclusions.filter((exclusion) => expenseCategoryIds.has(exclusion.categoryId));
  if (relevantExclusions.length === 0) return 0;

  const excludedCategories = new Set(
    relevantExclusions
      .filter((exclusion) => exclusion.description === '')
      .map((exclusion) => exclusion.categoryId)
  );
  const excludedConcepts = new Set(
    relevantExclusions
      .filter((exclusion) => exclusion.description !== '')
      .map((exclusion) => `${exclusion.categoryId}::${exclusion.description}`)
  );
  const categoryIds = Array.from(new Set(relevantExclusions.map((exclusion) => exclusion.categoryId)));

  const pendingTransactions = await prisma.transaction.findMany({
    where: {
      userId,
      type: 'EXPENSE',
      status: 'PENDING',
      categoryId: { in: categoryIds },
      date: { lte: endOfCurrentDayUtc() }
    },
    select: {
      id: true,
      categoryId: true,
      description: true
    }
  });

  const transactionIds = pendingTransactions
    .filter((transaction) => {
      if (!transaction.categoryId) return false;
      if (excludedCategories.has(transaction.categoryId)) return true;
      return excludedConcepts.has(`${transaction.categoryId}::${normalizeDescription(transaction.description)}`);
    })
    .map((transaction) => transaction.id);

  if (transactionIds.length === 0) return 0;

  const result = await prisma.transaction.updateMany({
    where: { id: { in: transactionIds } },
    data: { status: 'PAID' }
  });

  return result.count;
}
