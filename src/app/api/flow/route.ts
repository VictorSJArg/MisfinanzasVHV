import { NextRequest, NextResponse } from 'next/server';
import {
  eachDayOfInterval,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  getMonth,
  startOfDay,
  startOfMonth,
  startOfWeek
} from 'date-fns';
import { es } from 'date-fns/locale';
import { prisma } from '@/lib/prisma';
import { CreditCardProjection, getCreditCardProjectionsForRange } from '@/lib/creditCardProjections';

interface Period {
  date: Date;
  startDate: Date;
  endDate: Date;
  weekNumber: number;
}

interface CategoryRow {
  id: string;
  name: string;
  type: string;
  icon: string | null;
  color: string | null;
  parentId: string | null;
  sortOrder: number;
  userId: string;
}

interface CellTransaction {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  accountName?: string;
  status: string;
  isProjection: boolean;
  referenceId?: string;
}

interface CellData {
  amount: number;
  transactions: CellTransaction[];
}

interface RowData {
  category: CategoryRow | {
    id: string;
    name: string;
    type: string;
    icon?: string;
    color?: string;
    isVirtual?: boolean;
    isExpandable?: boolean;
  };
  cells: number[];
  cellDetails: CellData[];
  total: number;
  subRows?: RowData[];
}

const tcCategories = [
  'COMBUSTIBLE',
  'ALIMENTOS',
  'ENTRETENIMIENTO',
  'SERVICIOS',
  'SEGUROS',
  'SALUD',
  'GASTRONOMIA',
  'ROPA',
  'TRANSPORTE',
  'IMPUESTOS',
  'CARGOS',
  'STATEMENT',
  'NUEVOS_GASTOS',
  'OTROS'
];

const tcCategoryLabels: Record<string, string> = {
  COMBUSTIBLE: 'Combustible',
  ALIMENTOS: 'Alimentos',
  ENTRETENIMIENTO: 'Entretenimiento',
  SERVICIOS: 'Servicios',
  SEGUROS: 'Seguros',
  SALUD: 'Salud',
  GASTRONOMIA: 'Gastronomia',
  ROPA: 'Ropa',
  TRANSPORTE: 'Transporte',
  IMPUESTOS: 'Impuestos',
  CARGOS: 'Cargos',
  STATEMENT: 'Pago Resumen',
  NUEVOS_GASTOS: 'Nuevos Gastos de Tarjeta',
  OTROS: 'Otros'
};

function safeAdd(a: number, b: number) {
  return Math.round((a + b) * 100) / 100;
}

function createPeriods(start: Date, end: Date, granularity: string): Period[] {
  if (granularity === 'day') {
    return eachDayOfInterval({ start, end }).map((date, index) => ({
      date,
      startDate: startOfDay(date),
      endDate: endOfDay(date),
      weekNumber: index + 1
    }));
  }

  if (granularity === 'month') {
    return eachMonthOfInterval({ start, end }).map((date, index) => ({
      date,
      startDate: startOfMonth(date),
      endDate: endOfMonth(date),
      weekNumber: index + 1
    }));
  }

  return eachWeekOfInterval({ start, end }, { weekStartsOn: 0 }).map((date, index) => ({
    date,
    startDate: startOfWeek(date, { weekStartsOn: 0 }),
    endDate: endOfWeek(date, { weekStartsOn: 0 }),
    weekNumber: index + 1
  }));
}

function findPeriodIndex(date: Date, periods: Period[]) {
  return periods.findIndex((period) => date >= period.startDate && date <= period.endDate);
}

function emptyCells(periods: Period[]): CellData[] {
  return periods.map(() => ({ amount: 0, transactions: [] }));
}

function cellKey(id: string, periodIndex: number) {
  return `${id}::${periodIndex}`;
}

async function loadCategories(userId: string): Promise<CategoryRow[]> {
  try {
    return await prisma.$queryRaw<CategoryRow[]>`
      SELECT id, name, type, icon, color, "parentId", "sortOrder", "userId"
      FROM "Category"
      WHERE "userId" = ${userId}
      ORDER BY "sortOrder" ASC, name ASC
    `;
  } catch {
    return prisma.$queryRaw<CategoryRow[]>`
      SELECT id, name, type, icon, color, "parentId", 0 AS "sortOrder", "userId"
      FROM "Category"
      WHERE "userId" = ${userId}
      ORDER BY name ASC
    `;
  }
}

function labelForPeriod(period: Period, granularity: string) {
  if (granularity === 'month') {
    return {
      main: format(period.date, 'MMM yyyy', { locale: es }),
      sub: null as string | null
    };
  }

  if (granularity === 'week') {
    const startMonth = getMonth(period.startDate);
    const endMonth = getMonth(period.endDate);
    const monthLabel = startMonth !== endMonth
      ? `${format(period.startDate, 'MMM', { locale: es })}-${format(period.endDate, 'MMM', { locale: es })}`
      : `${format(period.date, 'MMM', { locale: es })} '${format(period.date, 'yy')}`;

    return {
      main: monthLabel,
      sub: `Sem ${period.weekNumber}`
    };
  }

  return {
    main: format(period.date, 'EEE', { locale: es }),
    sub: format(period.date, 'dd MMM', { locale: es })
  };
}

function buildTransactionRows(
  categories: CategoryRow[],
  periods: Period[],
  buckets: Map<string, CellData>
): RowData[] {
  return categories.map((category) => {
    const cellDetails = emptyCells(periods);

    for (let index = 0; index < periods.length; index++) {
      const bucket = buckets.get(cellKey(category.id, index));
      if (bucket) cellDetails[index] = bucket;
    }

    return {
      category,
      cells: cellDetails.map((cell) => cell.amount),
      cellDetails,
      total: cellDetails.reduce((sum, cell) => safeAdd(sum, cell.amount), 0)
    };
  });
}

function buildProjectionBuckets(projections: CreditCardProjection[], periods: Period[]) {
  const buckets = new Map<string, CellData>();

  for (const projection of projections) {
    if (projection.status === 'CANCELLED') continue;

    const periodIndex = findPeriodIndex(new Date(projection.date), periods);
    if (periodIndex === -1) continue;

    const category = projection.category || 'OTROS';
    const key = cellKey(category, periodIndex);
    const bucket = buckets.get(key) || { amount: 0, transactions: [] };

    bucket.amount = safeAdd(bucket.amount, projection.amount);
    bucket.transactions.push({
      id: projection.referenceId || 'proj',
      date: projection.date,
      amount: projection.amount,
      description: projection.description,
      status: projection.status || 'PENDING',
      isProjection: true,
      referenceId: projection.referenceId
    });

    buckets.set(key, bucket);
  }

  return buckets;
}

function buildCreditCardRow(periods: Period[], projections: CreditCardProjection[]): RowData | null {
  const projectionBuckets = buildProjectionBuckets(projections, periods);

  const subRows = tcCategories.map((category) => {
    const cellDetails = emptyCells(periods);

    for (let index = 0; index < periods.length; index++) {
      const bucket = projectionBuckets.get(cellKey(category, index));
      if (bucket) cellDetails[index] = bucket;
    }

    const total = cellDetails.reduce((sum, cell) => safeAdd(sum, cell.amount), 0);
    if (total === 0) return null;

    return {
      category: {
        id: `__TC_${category}__`,
        name: tcCategoryLabels[category] || category,
        type: 'EXPENSE'
      },
      cells: cellDetails.map((cell) => cell.amount),
      cellDetails,
      total
    };
  }).filter((row): row is RowData => row !== null);

  const total = subRows.reduce((sum, row) => safeAdd(sum, row.total), 0);
  if (total === 0) return null;

  const cellDetails = periods.map((_, index) => {
    const amount = subRows.reduce((sum, row) => safeAdd(sum, row.cells[index] || 0), 0);
    return { amount, transactions: [] };
  });

  return {
    category: {
      id: '__TC__',
      name: 'Gastos TC',
      type: 'EXPENSE',
      icon: 'TC',
      color: '#9333ea',
      isVirtual: true,
      isExpandable: true
    },
    cells: cellDetails.map((cell) => cell.amount),
    cellDetails,
    total,
    subRows
  };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startStr = searchParams.get('start');
    const endStr = searchParams.get('end');
    const granularity = searchParams.get('granularity') || 'week';
    const includeTransactions = searchParams.get('includeTransactions') === 'true';

    if (!startStr || !endStr) {
      return NextResponse.json({ error: 'Dates required' }, { status: 400 });
    }

    const user = await prisma.user.findFirst();
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 400 });

    const start = new Date(startStr.includes('T') ? startStr : `${startStr}T00:00:00`);
    const end = endOfDay(new Date(endStr.includes('T') ? endStr : `${endStr}T23:59:59.999`));
    const periods = createPeriods(start, end, granularity);

    const [transactions, categories, creditCardProjections] = await Promise.all([
      prisma.transaction.findMany({
        where: {
          userId: user.id,
          status: { not: 'CANCELLED' },
          date: { gte: start, lte: end }
        },
        include: { account: true },
        orderBy: { date: 'asc' }
      }),
      loadCategories(user.id),
      getCreditCardProjectionsForRange(user.id, start, end)
    ]);

    const transactionBuckets = new Map<string, CellData>();
    for (const transaction of transactions) {
      if (!transaction.categoryId) continue;

      const periodIndex = findPeriodIndex(transaction.date, periods);
      if (periodIndex === -1) continue;

      const key = cellKey(transaction.categoryId, periodIndex);
      const bucket = transactionBuckets.get(key) || { amount: 0, transactions: [] };

      bucket.amount = safeAdd(bucket.amount, Number(transaction.amount));
      if (includeTransactions) {
        bucket.transactions.push({
          id: transaction.id,
          date: transaction.date.toISOString(),
          amount: Number(transaction.amount),
          description: transaction.description,
          accountName: transaction.account?.name || '',
          status: transaction.status || 'PAID',
          isProjection: false
        });
      }

      transactionBuckets.set(key, bucket);
    }

    const rows = buildTransactionRows(categories, periods, transactionBuckets);
    const incomeRows = rows.filter((row) => row.category.type === 'INCOME');
    let expenseRows = rows.filter((row) => row.category.type === 'EXPENSE');

    const tcRow = buildCreditCardRow(periods, creditCardProjections);
    if (tcRow) expenseRows = [...expenseRows, tcRow];

    const summary = periods.map((_, index) => {
      const income = incomeRows.reduce((sum, row) => safeAdd(sum, row.cells[index] || 0), 0);
      const expense = expenseRows.reduce((sum, row) => safeAdd(sum, row.cells[index] || 0), 0);

      return {
        income,
        expense,
        balance: safeAdd(income, -expense)
      };
    });

    return NextResponse.json({
      columns: periods.map((period) => {
        const labelInfo = labelForPeriod(period, granularity);
        return {
          date: period.date.toISOString(),
          startDate: period.startDate.toISOString(),
          endDate: period.endDate.toISOString(),
          label: labelInfo.sub ? `${labelInfo.main}|${labelInfo.sub}` : labelInfo.main,
          labelMain: labelInfo.main,
          labelSub: labelInfo.sub
        };
      }),
      incomeRows,
      expenseRows,
      summary
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('API Flow Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
