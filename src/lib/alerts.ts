import { addDays } from 'date-fns';
import { prisma } from '@/lib/prisma';
import { CreditCardProjection, getCreditCardProjectionsForRange } from '@/lib/creditCardProjections';

export const ALERT_DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';
export const ALERT_DEFAULT_DAYS_BEFORE = 1;
export const ALERT_DEFAULT_WINDOW_DAYS = 30;
export const ALERT_DEFAULT_NOTIFY_HOUR = 8;
export const ALERT_CHANNEL = 'WHATSAPP';

export interface AlertPreferenceSnapshot {
  enabled: boolean;
  phone: string;
  daysBefore: number;
  alertWindowDays: number;
  notifyHour: number;
  timezone: string;
}

export interface PendingAlertItem {
  id: string;
  sourceType: 'TRANSACTION' | 'PROJECTION';
  sourceId: string;
  alertKey: string;
  title: string;
  description: string;
  sourceLabel: string;
  categoryName: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
  status: string;
  referenceId?: string;
  projectionRefs?: { referenceId: string; date: string }[];
}

export interface PendingAlertsSummary {
  overdueCount: number;
  dueTodayCount: number;
  dueTomorrowCount: number;
  upcomingCount: number;
  totalAmount: number;
}

export interface PendingAlertsResult {
  items: PendingAlertItem[];
  summary: PendingAlertsSummary;
  today: string;
  timeZone: string;
}

interface PendingAlertOptions {
  referenceDate?: Date;
  timeZone?: string;
  daysBack?: number;
  daysAhead?: number;
}

interface DispatchScheduledAlertsOptions {
  dryRun?: boolean;
  referenceDate?: Date;
  userId?: string;
}

interface DispatchUserResult {
  userId: string;
  phone: string;
  dueDate: string | null;
  sent: boolean;
  dryRun: boolean;
  reason?: string;
  error?: string;
  itemCount: number;
  totalAmount: number;
  message?: string;
}

function getDateFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function getDisplayDateFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function getDateParts(date: Date, timeZone: string) {
  const parts = getDateFormatter(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';

  return { year, month, day };
}

export function dateKeyFromDate(date: Date, timeZone = ALERT_DEFAULT_TIMEZONE) {
  const { year, month, day } = getDateParts(date, timeZone);
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export function shiftDateKey(key: string, days: number) {
  const shifted = addDays(parseDateKey(key), days);
  return dateKeyFromDate(shifted, 'UTC');
}

function startOfDateKeyUtc(key: string) {
  return parseDateKey(key);
}

function endOfDateKeyUtc(key: string) {
  return new Date(`${key}T23:59:59.999Z`);
}

function diffDays(fromKey: string, toKey: string) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / msPerDay);
}

function money(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount);
}

function sanitizePhone(phone: string | null | undefined) {
  return String(phone || '').replace(/[^\d]/g, '');
}

function envDefaultPhone() {
  const firstAllowed = process.env.ASSISTANT_ALLOWED_PHONE?.trim().split(',')[0] || '';
  return sanitizePhone(firstAllowed);
}

function normalizedAlertDescription(description: string | null | undefined) {
  return description?.trim() || '';
}

export function normalizeAlertPreference(preference?: {
  enabled?: boolean;
  phone?: string | null;
  daysBefore?: number;
  alertWindowDays?: number;
  notifyHour?: number;
  timezone?: string | null;
} | null): AlertPreferenceSnapshot {
  return {
    enabled: preference?.enabled ?? true,
    phone: sanitizePhone(preference?.phone) || envDefaultPhone(),
    daysBefore: preference?.daysBefore ?? ALERT_DEFAULT_DAYS_BEFORE,
    alertWindowDays: preference?.alertWindowDays ?? ALERT_DEFAULT_WINDOW_DAYS,
    notifyHour: preference?.notifyHour ?? ALERT_DEFAULT_NOTIFY_HOUR,
    timezone: preference?.timezone || ALERT_DEFAULT_TIMEZONE
  };
}

function transactionAlertItem(
  transaction: {
    id: string;
    amount: unknown;
    date: Date;
    status: string;
    description: string | null;
    category: { name: string } | null;
    account: { name: string } | null;
  },
  todayKey: string
): PendingAlertItem {
  const dueDate = dateKeyFromDate(transaction.date, 'UTC');
  const title = transaction.description?.trim() || transaction.category?.name || 'Gasto pendiente';
  const categoryName = transaction.category?.name || 'Sin categoría';
  const sourceLabel = transaction.account?.name || 'Cuenta general';

  return {
    id: `tx:${transaction.id}`,
    sourceType: 'TRANSACTION',
    sourceId: transaction.id,
    alertKey: `transaction:${transaction.id}:${dueDate}`,
    title,
    description: transaction.description?.trim() || `Pendiente en ${categoryName}`,
    sourceLabel,
    categoryName,
    amount: Number(transaction.amount),
    dueDate,
    daysUntilDue: diffDays(todayKey, dueDate),
    status: transaction.status
  };
}

function aggregateProjectionAlertItems(projections: CreditCardProjection[], todayKey: string, timeZone: string): PendingAlertItem[] {
  const buckets = new Map<string, PendingAlertItem>();

  for (const projection of projections) {
    const dueDate = dateKeyFromDate(new Date(projection.date), timeZone);
    const bucketKey = dueDate;
    const current = buckets.get(bucketKey);
    const referenceId = projection.referenceId || `projection:${projection.description}:${projection.date}`;
    const cardName = projection.cardName || 'Tarjeta';

    if (!current) {
      buckets.set(bucketKey, {
        id: `projection:credit-card:${dueDate}`,
        sourceType: 'PROJECTION',
        sourceId: `credit-card:${dueDate}`,
        alertKey: `credit-card:${dueDate}`,
        title: 'Tarjeta de Credito',
        description: 'Vencimiento de Tarjeta de Credito',
        sourceLabel: cardName,
        categoryName: 'Resumen TC',
        amount: Number(projection.amount),
        dueDate,
        daysUntilDue: diffDays(todayKey, dueDate),
        status: 'PENDING',
        referenceId,
        projectionRefs: [{ referenceId, date: projection.date }]
      });
      continue;
    }

    current.amount += Number(projection.amount);
    current.projectionRefs = [
      ...(current.projectionRefs || []),
      { referenceId, date: projection.date }
    ];

    const sourceLabels = new Set(current.sourceLabel.split(', ').filter(Boolean));
    sourceLabels.add(cardName);
    current.sourceLabel = Array.from(sourceLabels).join(', ');
    current.description = `Vencimiento de Tarjeta de Credito (${current.projectionRefs.length} gastos)`;
  }

  return Array.from(buckets.values());
}

function buildSummary(items: PendingAlertItem[]): PendingAlertsSummary {
  return items.reduce<PendingAlertsSummary>((summary, item) => {
    if (item.daysUntilDue < 0) summary.overdueCount += 1;
    else if (item.daysUntilDue === 0) summary.dueTodayCount += 1;
    else if (item.daysUntilDue === 1) summary.dueTomorrowCount += 1;
    else summary.upcomingCount += 1;

    summary.totalAmount += item.amount;
    return summary;
  }, {
    overdueCount: 0,
    dueTodayCount: 0,
    dueTomorrowCount: 0,
    upcomingCount: 0,
    totalAmount: 0
  });
}

export async function getPendingAlertsForUser(userId: string, options: PendingAlertOptions = {}): Promise<PendingAlertsResult> {
  const timeZone = options.timeZone || ALERT_DEFAULT_TIMEZONE;
  const referenceDate = options.referenceDate || new Date();
  const today = dateKeyFromDate(referenceDate, timeZone);
  const daysBack = options.daysBack ?? 30;
  const daysAhead = options.daysAhead ?? 60;
  const startKey = shiftDateKey(today, -daysBack);
  const endKey = shiftDateKey(today, daysAhead);
  const rangeStart = startOfDateKeyUtc(startKey);
  const rangeEnd = endOfDateKeyUtc(endKey);

  const [transactions, projections, dismissals, exclusions] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        userId,
        type: 'EXPENSE',
        status: 'PENDING',
        date: { gte: rangeStart, lte: rangeEnd }
      },
      include: {
        category: { select: { name: true } },
        account: { select: { name: true } }
      },
      orderBy: { date: 'asc' }
    }),
    getCreditCardProjectionsForRange(userId, rangeStart, rangeEnd),
    prisma.alertDismissal.findMany({
      where: {
        userId,
        dueDate: { gte: rangeStart, lte: rangeEnd }
      },
      select: { alertKey: true }
    }),
    prisma.alertExclusion.findMany({
      where: { userId },
      select: {
        categoryId: true,
        description: true
      }
    })
  ]);

  const dismissedKeys = new Set(dismissals.map((dismissal) => dismissal.alertKey));
  const excludedCategories = new Set(
    exclusions
      .filter((exclusion) => exclusion.description === '')
      .map((exclusion) => exclusion.categoryId)
  );
  const excludedSubConcepts = new Set(
    exclusions
      .filter((exclusion) => exclusion.description !== '')
      .map((exclusion) => `${exclusion.categoryId}::${exclusion.description}`)
  );
  const alertableTransactions = transactions.filter((transaction) => {
    if (!transaction.categoryId) return true;
    if (excludedCategories.has(transaction.categoryId)) return false;
    return !excludedSubConcepts.has(`${transaction.categoryId}::${normalizedAlertDescription(transaction.description)}`);
  });

  const items = [
    ...alertableTransactions.map((transaction) => transactionAlertItem(transaction, today)),
    ...aggregateProjectionAlertItems(
      projections.filter((projection) => projection.status !== 'PAID' && projection.status !== 'CANCELLED'),
      today,
      timeZone
    )
  ]
    .filter((item) => item.dueDate >= startKey && item.dueDate <= endKey)
    .filter((item) => !dismissedKeys.has(item.alertKey))
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return b.amount - a.amount;
    });

  return {
    items,
    summary: buildSummary(items),
    today,
    timeZone
  };
}

export function formatDateForDisplay(dateKey: string, timeZone = ALERT_DEFAULT_TIMEZONE) {
  return getDisplayDateFormatter(timeZone).format(new Date(`${dateKey}T12:00:00.000Z`));
}

export function buildWhatsAppAlertMessage(items: PendingAlertItem[], dueDate: string, timeZone: string) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const overdueCount = items.filter((item) => item.daysUntilDue < 0).length;
  const todayCount = items.filter((item) => item.daysUntilDue === 0).length;
  const lines = items.slice(0, 8).map((item) => {
    const source = item.sourceLabel ? ` · ${item.sourceLabel}` : '';
    const dueLabel = item.daysUntilDue < 0
      ? `vencio el ${formatDateForDisplay(item.dueDate, timeZone)}`
      : item.daysUntilDue === 0
        ? 'vence hoy'
        : `vence el ${formatDateForDisplay(item.dueDate, timeZone)}`;
    return `- ${item.title}: ${money(item.amount)} (${dueLabel})${source}`;
  });

  if (items.length > 8) {
    lines.push(`- y ${items.length - 8} pendiente(s) más`);
  }

  return [
    `Alertas financieras pendientes al ${formatDateForDisplay(dueDate, timeZone)}.`,
    `Incluye ${overdueCount} vencido(s) y ${todayCount} de hoy.`,
    `Tenés ${items.length} pendiente(s) por ${money(total)}.`,
    ...lines,
    'Podés revisarlos y marcarlos como pagados en la sección Alertas de la app.'
  ].join('\n');
}

async function sendAlertWebhook(payload: Record<string, unknown>) {
  const url = process.env.N8N_ALERT_WEBHOOK_URL?.trim();
  if (!url) {
    throw new Error('N8N_ALERT_WEBHOOK_URL is not configured');
  }

  const token = process.env.N8N_ALERT_WEBHOOK_TOKEN?.trim();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Alert webhook failed (${response.status}): ${text}`);
  }

  return response;
}

function evolutionNumber(phone: string) {
  return String(phone || '').replace(/[^\d]/g, '');
}

async function sendAlertViaEvolution(phone: string, text: string) {
  const baseUrl = process.env.EVOLUTION_BASE_URL?.trim();
  const instance = process.env.EVOLUTION_INSTANCE?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();

  if (!baseUrl || !instance || !apiKey) {
    throw new Error('Evolution API is not configured');
  }

  const number = evolutionNumber(phone);
  if (!number) {
    throw new Error('No pude resolver un numero valido para Evolution.');
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/message/sendText/${instance}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey
    },
    body: JSON.stringify({
      number,
      text,
      delay: 2000
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Evolution send failed (${response.status}): ${errorText}`);
  }

  return response;
}

export async function dispatchScheduledAlerts(options: DispatchScheduledAlertsOptions = {}) {
  const referenceDate = options.referenceDate || new Date();
  const users = await prisma.user.findMany({
    where: options.userId ? { id: options.userId } : undefined,
    include: { alertPreference: true }
  });

  const results: DispatchUserResult[] = [];

  for (const user of users) {
    const preference = normalizeAlertPreference(user.alertPreference);
    const scheduleDate = dateKeyFromDate(referenceDate, preference.timezone);
    const dueDate = shiftDateKey(scheduleDate, preference.daysBefore);

    if (!preference.enabled) {
      results.push({
        userId: user.id,
        phone: preference.phone,
        dueDate,
        sent: false,
        dryRun: Boolean(options.dryRun),
        reason: 'disabled',
        itemCount: 0,
        totalAmount: 0
      });
      continue;
    }

    if (!preference.phone) {
      results.push({
        userId: user.id,
        phone: '',
        dueDate,
        sent: false,
        dryRun: Boolean(options.dryRun),
        reason: 'missing_phone',
        itemCount: 0,
        totalAmount: 0
      });
      continue;
    }

    const pending = await getPendingAlertsForUser(user.id, {
      referenceDate,
      timeZone: preference.timezone,
      daysBack: Math.max(preference.alertWindowDays, 365),
      daysAhead: Math.max(preference.daysBefore, 1)
    });

    const dueItems = pending.items.filter((item) => item.daysUntilDue <= 0 || item.daysUntilDue === preference.daysBefore);
    if (dueItems.length === 0) {
      results.push({
        userId: user.id,
        phone: preference.phone,
        dueDate,
        sent: false,
        dryRun: Boolean(options.dryRun),
        reason: 'no_items',
        itemCount: 0,
        totalAmount: 0
      });
      continue;
    }

    const scheduledForStart = startOfDateKeyUtc(scheduleDate);
    const scheduledForEnd = endOfDateKeyUtc(scheduleDate);
    const existingLogs = await prisma.alertDispatchLog.findMany({
      where: {
        userId: user.id,
        channel: ALERT_CHANNEL,
        scheduledFor: { gte: scheduledForStart, lte: scheduledForEnd },
        alertKey: { in: dueItems.map((item) => item.alertKey) }
      },
      select: { alertKey: true }
    });

    const existingKeys = new Set(existingLogs.map((item) => item.alertKey));
    const unsentItems = dueItems.filter((item) => !existingKeys.has(item.alertKey));

    if (unsentItems.length === 0) {
      results.push({
        userId: user.id,
        phone: preference.phone,
        dueDate,
        sent: false,
        dryRun: Boolean(options.dryRun),
        reason: 'already_sent',
        itemCount: 0,
        totalAmount: 0
      });
      continue;
    }

    const message = buildWhatsAppAlertMessage(unsentItems, dueDate, preference.timezone);
    const totalAmount = unsentItems.reduce((sum, item) => sum + item.amount, 0);

    if (!options.dryRun) {
      try {
        if (process.env.EVOLUTION_BASE_URL?.trim() && process.env.EVOLUTION_INSTANCE?.trim() && process.env.EVOLUTION_API_KEY?.trim()) {
          await sendAlertViaEvolution(preference.phone, message);
        } else {
          await sendAlertWebhook({
            phone: preference.phone,
            text: message,
            source: 'scheduled-alert',
            scheduleDate,
            dueDate,
            daysBefore: preference.daysBefore,
            notifyHour: preference.notifyHour,
            timezone: preference.timezone,
            items: unsentItems,
            user: {
              id: user.id,
              email: user.email,
              name: user.name
            }
          });
        }

        await prisma.alertDispatchLog.createMany({
          data: unsentItems.map((item) => ({
            userId: user.id,
            alertKey: item.alertKey,
            scheduledFor: scheduledForStart,
            channel: ALERT_CHANNEL
          }))
        });
      } catch (error) {
        results.push({
          userId: user.id,
          phone: preference.phone,
          dueDate,
          sent: false,
          dryRun: false,
          reason: 'send_failed',
          error: error instanceof Error ? error.message : 'Unknown send error',
          itemCount: unsentItems.length,
          totalAmount,
          message
        });
        continue;
      }
    }

    results.push({
      userId: user.id,
      phone: preference.phone,
      dueDate,
      sent: true,
      dryRun: Boolean(options.dryRun),
      itemCount: unsentItems.length,
      totalAmount,
      message
    });
  }

  return {
    ok: true,
    runDate: referenceDate.toISOString(),
    results
  };
}
