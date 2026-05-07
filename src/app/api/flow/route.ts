
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, startOfDay, endOfDay,
  eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval,
  format, isSameDay, isSameWeek, isSameMonth, getMonth, addMonths
} from 'date-fns';
import { es } from 'date-fns/locale';


export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startStr = searchParams.get('start');
    const endStr = searchParams.get('end');
    const granularity = searchParams.get('granularity') || 'week';
    const includeTransactions = searchParams.get('includeTransactions') === 'true';

    if (!startStr || !endStr) {
      return NextResponse.json({ error: "Dates required" }, { status: 400 });
    }

    // FIX: Force dates to be treated as Local Time to avoid UTC offsets shifting the days
    // We append T00:00:00 to ensure the Date constructor treats it as local time, not UTC
    const start = new Date(startStr.includes('T') ? startStr : `${startStr}T00:00:00`);
    const endRaw = new Date(endStr.includes('T') ? endStr : `${endStr}T23:59:59.999`);
    const end = endOfDay(endRaw);

    // 1. Generate Columns (Periods) with start/end dates
    interface Period {
      date: Date;
      startDate: Date;
      endDate: Date;
      weekNumber: number; // Número secuencial de semana
    }

    let periods: Period[] = [];

    if (granularity === 'day') {
      const days = eachDayOfInterval({ start, end });
      periods = days.map((d, idx) => ({
        date: d,
        startDate: startOfDay(d),
        endDate: endOfDay(d),
        weekNumber: idx + 1
      }));
    } else if (granularity === 'week') {
      const weeks = eachWeekOfInterval({ start, end }, { weekStartsOn: 0 });
      periods = weeks.map((w, idx) => ({
        date: w,
        startDate: startOfWeek(w, { weekStartsOn: 0 }),
        endDate: endOfWeek(w, { weekStartsOn: 0 }),
        weekNumber: idx + 1 // Numeración secuencial
      }));
    } else {
      const months = eachMonthOfInterval({ start, end });
      periods = months.map((m, idx) => ({
        date: m,
        startDate: startOfMonth(m),
        endDate: endOfMonth(m),
        weekNumber: idx + 1
      }));
    }

    // 2. Fetch Data
    const transactions = await prisma.transaction.findMany({
      where: {
        date: { gte: start, lte: end }
      },
      include: { category: true, account: true },
      orderBy: { date: 'asc' }
    });

    const categories = await prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
    });

    // 3. Fetch Credit Card Projections from the projections API (single source of truth)
    let creditCardProjections: { date: string; amount: number; description: string; type: string; category?: string; status?: string; referenceId?: string }[] = [];
    try {
      const user = await prisma.user.findFirst();
      if (user) {
        // Fetch statuses for paid/pending tracking
        const statuses = await prisma.projectionStatus.findMany({
          where: {
            date: { gte: start, lte: end }
          }
        });
        const statusMap = new Map(statuses.map((s: any) => [`${s.referenceId}-${s.date.toISOString()}`, s.status]));

        // Fetch cards with statements
        // Fetch cards with statements (fetch more history to cover previous months)
        const cards = await prisma.creditCard.findMany({
          where: { userId: user.id },
          include: {
            statements: {
              // Fetch statements relevant to the range or just the last few
              // We need enough history to cover the requested 'start' date if it's in the past
              // Getting the last 24 covers 2 years, safe for ghosts.
              orderBy: { dueDate: 'desc' },
              take: 24,
              include: { items: true }
            }
          }
        });

        // Fetch monthly overrides
        let monthlyOverrides = new Map<string, number>();
        try {
          const overridesData = await (prisma as any).projectionMonthlyOverride.findMany();
          overridesData.forEach((o: any) => {
            monthlyOverrides.set(`${o.itemId}-${o.yearMonth}`, Number(o.amount));
          });
        } catch (e) {
          // Table might not exist yet, ignore
        }

        for (const card of cards) {
          if (card.statements.length === 0) continue;

          // Identify the LATEST statement for FUTURE projections
          // The array is ordered descending, so index 0 is latest.
          const latestStatement = card.statements[0];

          // --- RECURSIVE GHOST LOGIC FOR ALL STATEMENTS ---
          // We need to ensure that EVERY statement (Dec, Jan, etc.) includes ghosts from its previous neighbor
          // just like the ProjectionGrid does when you view that specific month.
          // We iterate through statements. For statement at [i], we check [i+1] (older).
          for (let i = 0; i < card.statements.length; i++) {
            const currentStmt = card.statements[i];
            const prevStmt = (i + 1 < card.statements.length) ? card.statements[i + 1] : null; // Older statement

            if (prevStmt) {
              // Create fuzzy match helper like frontend
              // We need to check if prevItem exists in currentStmt
              const currentItems = currentStmt.items;

              for (const prevItem of prevStmt.items) {
                // Logic from tarjetas/page.tsx:
                // Only recurrring or unfinished installments
                if (!prevItem.isRecurring && (!prevItem.installmentTotal || prevItem.installmentCurrent === prevItem.installmentTotal)) {
                  continue;
                }

                // CHECK EXISTENCE FUZZY
                // Clean descriptions for comparison
                const cleanPrev = prevItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();

                const existsInCurrent = currentItems.some(currItem => {
                  const cleanCurr = currItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();
                  const descMatch = cleanCurr.includes(cleanPrev) || cleanPrev.includes(cleanCurr);

                  // If installment, check sequence
                  if (prevItem.installmentCurrent && currItem.installmentCurrent) {
                    return descMatch && currItem.installmentCurrent === prevItem.installmentCurrent + 1;
                  }
                  // If recurring, simple existence
                  return descMatch;
                });

                // Logic: Generate ghost even if prevItem was excluded (frontend does this)
                // Checks: Missing in current
                if (!existsInCurrent) {
                  // Inject Ghost into CURRENT Statement's month
                  // Validation: is currentStmt in view?
                  // We allowed take:24, so some might be outside.
                  // But we only inject if currentStmt is relevant to the Flow range?
                  // Actually, Flow aggregates by month. We should inject into the month of the Statement.

                  // Check date range - loosened to ensure we catch boundary months
                  const stmtDate = new Date(currentStmt.dueDate);
                  const startD = new Date(start);
                  const endD = new Date(end);

                  // Use simple string comparison or generic range
                  if (stmtDate >= startD && stmtDate <= endD) {
                    const dateStr = currentStmt.dueDate.toISOString();
                    const baseAmount = prevItem.projectedAmount !== null && prevItem.projectedAmount !== undefined
                      ? Number(prevItem.projectedAmount)
                      : Number(prevItem.amount);

                    creditCardProjections.push({
                      date: dateStr,
                      amount: baseAmount,
                      description: `(Est.) ${prevItem.description}`,
                      type: 'RECURRING',
                      category: prevItem.category || 'OTROS',
                      status: 'PENDING',
                      referenceId: `ghost-${prevItem.id}-${currentStmt.id}`
                    });
                  }

                  // SPECIAL CASE: Future Projections (Latest Statement)
                  // If we just added a ghost to the LATEST statement, we must also project it forward
                  if (i === 0) {
                    for (let k = 1; k <= 12; k++) {
                      const futureDate = endOfMonth(addMonths(currentStmt.dueDate, k));
                      if (futureDate < startD || futureDate > endD) continue;

                      const dateStr = futureDate.toISOString();
                      const baseAmount = prevItem.projectedAmount !== null ? Number(prevItem.projectedAmount) : Number(prevItem.amount);

                      creditCardProjections.push({
                        date: dateStr,
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
            }
          }

          // Process ALL fetched statements to cover "Actual" history (e.g., Dec, Jan)
          for (const statement of card.statements) {
            const isLatest = statement.id === latestStatement.id;

            // If the statement is completely outside the requested window (and is not latest doing future work), skip
            // But be careful: a statement due in Jan might be needed for a Jan column.
            // If statement.dueDate < start, and it's NOT the latest, we might skip it 
            // UNLESS we need to show historical data. 
            // Generally, if statement.dueDate is < start, its items (one-offs) are in the past. 
            // Only recurring/installments *might* project forward, but ONLY from the latest statement.
            // Historic statements should only contribute to their OWN month.

            if (statement.dueDate < start && !isLatest) continue; // Optimization
            // If statement is way in future beyond end?
            if (statement.dueDate > end && !isLatest) continue;

            for (const item of statement.items) {
              if (item.includeInProjection === false) continue;

              const baseAmount = item.projectedAmount !== null && item.projectedAmount !== undefined
                ? Number(item.projectedAmount)
                : Number(item.amount);

              // --- 1. CURRENT/ACTUAL MONTH logic (for THIS statement's due date) ---
              // We ALWAYS add the item to its own statement month (if within range)
              // This covers One-Offs, and the "current instance" of recurring/installments for this month.
              if (statement.dueDate >= start && statement.dueDate <= end) {
                const dateStr = statement.dueDate.toISOString();
                const yearMonth = format(statement.dueDate, 'yyyy-MM');

                // Check for override
                const overrideKey = `${item.id}-${yearMonth}`;
                const overrideAmount = monthlyOverrides.get(overrideKey);

                // FIX: For the CURRENT/ACTUAL month, we must use the actual 'item.amount', NOT 'baseAmount' (which might be the projected amount).
                // The 'Resumen Actual' column in ProjectionGrid uses item.amount. The Main Flow must match this.
                const amountToUse = Number(item.amount);

                const finalAmount = overrideAmount !== undefined ? overrideAmount : amountToUse;

                creditCardProjections.push({
                  date: dateStr,
                  amount: finalAmount,
                  description: item.description,
                  type: 'PURCHASE', // Can include recurring/installment current instances here simply as 'PURCHASE' or specific type
                  category: item.category || 'OTROS',
                  status: 'PENDING',
                  referenceId: item.id
                });
              }

              // --- 2. FUTURE PROJECTIONS logic ---
              // ONLY applies to the LATEST statement. We do NOT project from past statements 
              // because the latest statement supersedes them (contains the 'next' state).
              if (isLatest) {
                if (item.isRecurring) {
                  // Recurring items: project into future months (starting month + 1)
                  for (let i = 1; i <= 12; i++) { // Start from 1 because 0 (current) is handled above
                    const futureDate = endOfMonth(addMonths(statement.dueDate, i));
                    if (futureDate < start || futureDate > end) continue;

                    const dateStr = futureDate.toISOString();
                    const yearMonth = format(futureDate, 'yyyy-MM');
                    const lookupKey = `${item.id}-${dateStr}`;
                    const status = statusMap.get(lookupKey) || 'PENDING';

                    const overrideKey = `${item.id}-${yearMonth}`;
                    const overrideAmount = monthlyOverrides.get(overrideKey);
                    const finalAmount = overrideAmount !== undefined ? overrideAmount : baseAmount;

                    creditCardProjections.push({
                      date: dateStr,
                      amount: finalAmount,
                      description: `${item.description} (recurrente)`,
                      type: 'RECURRING',
                      category: item.category || 'OTROS',
                      status,
                      referenceId: item.id
                    });
                  }
                } else if (item.installmentCurrent && item.installmentTotal) {
                  // Installment items: project remaining installments
                  const remaining = item.installmentTotal - item.installmentCurrent;
                  for (let i = 1; i <= remaining; i++) {
                    const futureDate = endOfMonth(addMonths(statement.dueDate, i));
                    if (futureDate < start || futureDate > end) continue;

                    const dateStr = futureDate.toISOString();
                    const yearMonth = format(futureDate, 'yyyy-MM');
                    const lookupKey = `${item.id}-${dateStr}`;
                    const status = statusMap.get(lookupKey) || 'PENDING';

                    const overrideKey = `${item.id}-${yearMonth}`;
                    const overrideAmount = monthlyOverrides.get(overrideKey);
                    const finalAmount = overrideAmount !== undefined ? overrideAmount : baseAmount;

                    creditCardProjections.push({
                      date: dateStr,
                      amount: finalAmount,
                      description: `${item.description} (${item.installmentCurrent + i}/${item.installmentTotal})`,
                      type: 'INSTALLMENT',
                      category: item.category || 'OTROS',
                      status,
                      referenceId: item.id
                    });
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Error fetching credit card projections:', e);
    }

    // Helper for safe currency addition
    const safeAdd = (a: number, b: number) => Math.round((a + b) * 100) / 100;

    // 4. Build Matrix con transacciones por celda
    const rows = categories.map((cat: any) => {
      const cellsData = periods.map((period) => {
        const txs = transactions.filter((t: any) => {
          if (t.categoryId !== cat.id) return false;
          if (granularity === 'day') return isSameDay(t.date, period.date);
          if (granularity === 'week') return isSameWeek(t.date, period.date, { weekStartsOn: 0 });
          if (granularity === 'month') return isSameMonth(t.date, period.date);
          return false;
        });

        const sum = txs.reduce((acc: number, curr: any) => safeAdd(acc, Number(curr.amount)), 0);

        return {
          amount: sum,
          transactions: includeTransactions ? txs.map((t: any) => ({
            id: t.id,
            date: t.date.toISOString(),
            amount: Number(t.amount),
            description: t.description,
            accountName: t.account?.name || '',
            status: t.status || 'PAID', // Include status, default to PAID
            isProjection: false
          })) : []
        };
      });

      return {
        category: cat,
        cells: cellsData.map(c => c.amount),
        cellDetails: cellsData,
        total: cellsData.reduce((a, b) => safeAdd(a, b.amount), 0)
      };
    });

    // Create Credit Card row for expenses with category breakdown
    const tcCells = periods.map((period) => {
      const periodProjs = creditCardProjections.filter(p => {
        const projDate = new Date(p.date);
        if (granularity === 'day') return isSameDay(projDate, period.date);
        if (granularity === 'week') return isSameWeek(projDate, period.date, { weekStartsOn: 0 });
        if (granularity === 'month') return isSameMonth(projDate, period.date);
        return false;
      });
      return periodProjs.reduce((sum, p) => safeAdd(sum, p.amount), 0);
    });

    const tcTotal = tcCells.reduce((a, b) => safeAdd(a, b), 0);

    // Create category breakdown for TC
    const tcCategories = ['COMBUSTIBLE', 'ALIMENTOS', 'ENTRETENIMIENTO', 'SERVICIOS', 'SEGUROS', 'SALUD', 'GASTRONOMIA', 'ROPA', 'TRANSPORTE', 'IMPUESTOS', 'CARGOS', 'STATEMENT', 'OTROS'];

    const tcCategoryLabels: Record<string, string> = {
      'COMBUSTIBLE': '⛽ Combustible',
      'ALIMENTOS': '🛒 Alimentos',
      'ENTRETENIMIENTO': '🎬 Entretenimiento',
      'SERVICIOS': '📱 Servicios',
      'SEGUROS': '🛡️ Seguros',
      'SALUD': '💊 Salud',
      'GASTRONOMIA': '🍔 Gastronomía',
      'ROPA': '👕 Ropa',
      'TRANSPORTE': '🚗 Transporte',
      'IMPUESTOS': '📋 Impuestos',
      'CARGOS': '💸 Cargos',
      'STATEMENT': '💳 Pago Resumen',
      'OTROS': '📦 Otros'
    };

    const tcSubRows = tcCategories.map(cat => {
      const catCells = periods.map((period) => {
        const periodProjs = creditCardProjections.filter(p => {
          const projDate = new Date(p.date);
          const matchPeriod = granularity === 'day'
            ? isSameDay(projDate, period.date)
            : granularity === 'week'
              ? isSameWeek(projDate, period.date, { weekStartsOn: 0 })
              : isSameMonth(projDate, period.date);
          return matchPeriod && (p.category === cat || (cat === 'OTROS' && !p.category));
        });
        return periodProjs.reduce((sum, p) => safeAdd(sum, p.amount), 0);
      });

      const catTotal = catCells.reduce((a, b) => safeAdd(a, b), 0);

      if (catTotal === 0) return null;

      return {
        category: {
          id: `__TC_${cat}__`,
          name: tcCategoryLabels[cat] || cat,
          type: 'EXPENSE'
        },
        cells: catCells,
        cellDetails: catCells.map((amount, idx) => {
          // Find specific projections for this cell to support detail view and marking as paid
          const cellProjections = creditCardProjections.filter(p => {
            const projDate = new Date(p.date);
            const matchPeriod = granularity === 'day'
              ? isSameDay(projDate, periods[idx].date)
              : granularity === 'week'
                ? isSameWeek(projDate, periods[idx].date, { weekStartsOn: 0 })
                : isSameMonth(projDate, periods[idx].date);
            return matchPeriod && (p.category === cat || (cat === 'OTROS' && !p.category));
          });
          return {
            amount,
            transactions: cellProjections.map(p => ({
              id: p.referenceId || 'proj',
              date: p.date,
              amount: p.amount,
              description: p.description,
              status: p.status, // Pass status to frontend
              isProjection: true, // Marker
              referenceId: p.referenceId
            }))
          };
        }),
        total: catTotal
      };
    }).filter(Boolean);

    // Recalculate TC total from subcategory rows to ensure consistency
    // This ensures the total matches exactly what's displayed in subcategories
    const tcSubRowTotal = tcSubRows.reduce((sum, row: any) => safeAdd(sum, row?.total || 0), 0);

    // Also recalculate tcCells from subcategory cells for consistency
    const tcCellsFromSubRows = periods.map((_, idx) => {
      return tcSubRows.reduce((sum, row: any) => safeAdd(sum, row?.cells?.[idx] || 0), 0);
    });

    const tcRow = tcSubRowTotal > 0 ? {
      category: {
        id: '__TC__',
        name: '💳 Gastos TC',
        type: 'EXPENSE',
        icon: '💳',
        color: '#9333ea',
        isVirtual: true,
        isExpandable: true
      },
      cells: tcCellsFromSubRows, // Use calculated cells from subcategories
      cellDetails: tcCellsFromSubRows.map(amount => ({ amount, transactions: [] })),
      total: tcSubRowTotal, // Use calculated total from subcategories
      subRows: tcSubRows
    } : null;

    // Organize by Type (Income/Expense)
    const incomeRows = rows.filter((r: any) => r.category.type === 'INCOME');
    let expenseRows = rows.filter((r: any) => r.category.type === 'EXPENSE');

    // Add TC row at the end of expenses if it has data
    if (tcRow) {
      expenseRows = [...expenseRows, tcRow];
    }

    // Calculate Column Totals (including TC projections)
    const summary = periods.map((_, idx) => {
      const income = incomeRows.reduce((acc: number, row: any) => safeAdd(acc, row.cells[idx]), 0);
      const expense = expenseRows.reduce((acc: number, row: any) => safeAdd(acc, row.cells[idx]), 0);
      return {
        income,
        expense,
        balance: safeAdd(income, -expense)
      };
    });

    // Generar labels con formato mejorado para semanas
    const generateLabel = (p: Period, idx: number) => {
      if (granularity === 'month') {
        return {
          main: format(p.date, 'MMM yyyy', { locale: es }),
          sub: null
        };
      }
      if (granularity === 'week') {
        const weekStart = p.startDate;
        const weekEnd = p.endDate;
        const startMonth = getMonth(weekStart);
        const endMonth = getMonth(weekEnd);

        let monthLabel: string;
        if (startMonth !== endMonth) {
          // La semana cruza dos meses
          const startMonthName = format(weekStart, 'MMM', { locale: es });
          const endMonthName = format(weekEnd, 'MMM', { locale: es });
          monthLabel = `${startMonthName}-${endMonthName}`;
        } else {
          // La semana está dentro de un solo mes
          const year = format(p.date, 'yy');
          monthLabel = `${format(p.date, 'MMM', { locale: es })} '${year}`;
        }

        return {
          main: monthLabel,
          sub: `Sem ${p.weekNumber}` // Numeración secuencial
        };
      }
      // day
      return {
        main: format(p.date, 'EEE', { locale: es }),
        sub: format(p.date, 'dd MMM', { locale: es })
      };
    };

    return NextResponse.json({
      columns: periods.map((p, idx) => {
        const labelInfo = generateLabel(p, idx);
        return {
          date: p.date.toISOString(),
          startDate: p.startDate.toISOString(),
          endDate: p.endDate.toISOString(),
          label: labelInfo.sub ? `${labelInfo.main}|${labelInfo.sub}` : labelInfo.main,
          labelMain: labelInfo.main,
          labelSub: labelInfo.sub
        };
      }),
      incomeRows,
      expenseRows,
      summary
    });
  } catch (error: any) {
    console.error("API Flow Error:", error);
    return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
}
