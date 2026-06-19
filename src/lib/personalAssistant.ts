import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  ALERT_DEFAULT_TIMEZONE,
  getPendingAlertsForUser,
  normalizeAlertPreference,
  dateKeyFromDate,
  parseDateKey,
  shiftDateKey
} from '@/lib/alerts';

export const PERSONAL_DEFAULT_TIMEZONE = ALERT_DEFAULT_TIMEZONE;
export const PERSONAL_CHANNEL_WHATSAPP = 'WHATSAPP';

type AssistantSource = 'APP' | 'WHATSAPP' | 'CHAT' | 'CRON';
type LogStatus = 'SUCCESS' | 'FAILED' | 'PENDING_CONFIRMATION';
type ScheduledAlertSourceType = 'REMINDER' | 'EVENT' | 'MESSAGE';

export interface PersonalOverviewOptions {
  referenceDate?: Date;
  timeZone?: string;
  daysAhead?: number;
  daysBack?: number;
}

interface DispatchPersonalAssistantOptions {
  dryRun?: boolean;
  referenceDate?: Date;
  userId?: string;
}

const PERSONAL_DISPATCH_LOOKBACK_MINUTES = 2;
const PERSONAL_SCHEDULE_GRACE_MINUTES = 5;

export interface ImportContactsResult {
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  totalRows: number;
  contacts: Array<{
    id: string;
    name: string;
    phone: string;
  }>;
}

export function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function asDate(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizePhone(value: unknown) {
  return String(value || '').replace(/[^\d]/g, '');
}

export function normalizeWhatsappPhone(value: unknown) {
  let phone = normalizePhone(value);
  if (!phone) return '';
  if (phone.startsWith('00')) phone = phone.slice(2);
  while (phone.startsWith('0') && phone.length > 10) phone = phone.slice(1);

  // Argentina mobile numbers commonly need 549 + area + number for WhatsApp.
  if (phone.length === 10) return `549${phone}`;
  if (phone.length === 11 && phone.startsWith('9')) return `54${phone}`;
  if (phone.length === 11 && phone[3] === '9') return `549${phone.slice(0, 3)}${phone.slice(4)}`;
  if (phone.startsWith('54') && !phone.startsWith('549') && phone.length === 12) {
    return `549${phone.slice(2)}`;
  }
  if (phone.startsWith('54') && phone.length === 13 && phone[5] === '9') {
    return `549${phone.slice(2, 5)}${phone.slice(6)}`;
  }

  return phone;
}

export function phoneFromPayload(payload: Record<string, unknown>) {
  const candidates = [
    payload.phone,
    payload.to,
    payload.contactPhone,
    payload.contactName,
    payload.name
  ];

  for (const candidate of candidates) {
    const raw = normalizePhone(candidate);
    if (raw.length >= 8) return normalizeWhatsappPhone(candidate);
  }

  return '';
}

function normalizeSearchText(value: unknown) {
  return asString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchableTokens(value: unknown) {
  const ignored = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'mi', 'mio', 'mia', 'amor']);
  return normalizeSearchText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !ignored.has(token));
}

function bestTitleMatch<T extends { title: string }>(items: T[], query: string) {
  const requested = normalizeSearchText(query);
  const requestedTokens = searchableTokens(query);
  if (!requested && requestedTokens.length === 0) return null;

  const scored = items
    .map((item) => {
      const title = normalizeSearchText(item.title);
      const titleTokens = searchableTokens(item.title);
      let score = 0;
      if (title === requested) score += 100;
      if (requested && title.includes(requested)) score += 40;
      for (const token of requestedTokens) {
        if (titleTokens.includes(token)) score += 12;
        else if (title.includes(token)) score += 6;
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const [best, second] = scored;
  if (second && best.score === second.score) return null;
  return best.item;
}

function clampLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function asBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  const text = asString(value).toLowerCase();
  if (!text) return false;
  return ['true', '1', 'si', 'sí', 'yes'].includes(text);
}

function normalizePriority(value: unknown) {
  const priority = asString(value).toUpperCase();
  return ['LOW', 'MEDIUM', 'HIGH'].includes(priority) ? priority : 'MEDIUM';
}

function normalizeTaskStatus(value: unknown) {
  const status = asString(value).toUpperCase();
  return ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'].includes(status) ? status : 'PENDING';
}

function normalizeReminderStatus(value: unknown) {
  const status = asString(value).toUpperCase();
  return ['PENDING', 'DONE', 'CANCELLED'].includes(status) ? status : 'PENDING';
}

function normalizeEventStatus(value: unknown) {
  const status = asString(value).toUpperCase();
  return ['SCHEDULED', 'DONE', 'CANCELLED'].includes(status) ? status : 'SCHEDULED';
}

function hasPayloadValue(payload: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function startOfDateKeyUtc(key: string) {
  return parseDateKey(key);
}

function endOfDateKeyUtc(key: string) {
  return new Date(`${key}T23:59:59.999Z`);
}

function evolutionNumber(phone: string) {
  return normalizePhone(phone);
}

function money(amount: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(amount);
}

function displayDateTime(date: Date, timeZone = PERSONAL_DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function localHour(date: Date, timeZone = PERSONAL_DEFAULT_TIMEZONE) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hour12: false
  }).format(date);
  return Number(hour);
}

function hasReachedLocalHour(date: Date, notifyHour: number, timeZone = PERSONAL_DEFAULT_TIMEZONE) {
  const hour = localHour(date, timeZone);
  return Number.isFinite(hour) && hour >= notifyHour;
}

function minutesBefore(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function minutesAfter(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addRecurrence(date: Date, recurrence?: string | null) {
  const next = new Date(date);
  const normalized = asString(recurrence).toUpperCase();
  if (normalized === 'DAILY') next.setDate(next.getDate() + 1);
  else if (normalized === 'WEEKLY') next.setDate(next.getDate() + 7);
  else if (normalized === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else if (normalized === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
  else return null;
  return next;
}

export async function getDefaultUser() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error('No user found');
  return user;
}

export async function logAssistantAction(
  userId: string,
  action: string,
  status: LogStatus,
  summary: string,
  payload?: unknown,
  source: AssistantSource = 'APP'
) {
  try {
    await prisma.assistantActionLog.create({
      data: {
        userId,
        source,
        action,
        status,
        summary,
        payload: payload === undefined ? undefined : payload as object
      }
    });
  } catch (error) {
    console.error('Error logging assistant action:', error);
  }
}

function personalSchedulerToken() {
  return process.env.N8N_PERSONAL_SCHEDULER_TOKEN?.trim() || process.env.N8N_ALERT_WEBHOOK_TOKEN?.trim() || '';
}

function appBaseUrl() {
  return process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || '';
}

async function publishScheduledAlertToN8n(job: {
  id: string;
  userId: string;
  sourceType: string;
  sourceId: string;
  scheduledFor: Date;
  timezone: string;
  version: number;
}) {
  const url = process.env.N8N_PERSONAL_SCHEDULER_WEBHOOK_URL?.trim();
  const token = personalSchedulerToken();
  const baseUrl = appBaseUrl();

  if (!url) throw new Error('N8N_PERSONAL_SCHEDULER_WEBHOOK_URL is not configured');
  if (!baseUrl) throw new Error('APP_BASE_URL is not configured');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      scheduledAlertId: job.id,
      userId: job.userId,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      scheduledFor: job.scheduledFor.toISOString(),
      timezone: job.timezone,
      version: job.version,
      callbackUrl: `${baseUrl.replace(/\/$/, '')}/api/personal-assistant/scheduled-alert`
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`n8n scheduler failed (${response.status}): ${text}`);
  }

  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

async function schedulePersonalAlert(
  userId: string,
  sourceType: ScheduledAlertSourceType,
  sourceId: string,
  scheduledFor: Date,
  timezone = PERSONAL_DEFAULT_TIMEZONE,
  payload: Record<string, unknown> = {}
) {
  if (scheduledFor <= new Date()) {
    return prisma.assistantScheduledAlert.create({
      data: {
        userId,
        sourceType,
        sourceId,
        scheduledFor,
        timezone,
        status: 'SKIPPED',
        error: 'scheduled_for_is_not_future',
        payload: payload as Prisma.JsonObject
      }
    });
  }

  const previous = await prisma.assistantScheduledAlert.findFirst({
    where: { sourceType, sourceId },
    orderBy: { version: 'desc' }
  });
  const version = (previous?.version || 0) + 1;

  await prisma.assistantScheduledAlert.updateMany({
    where: {
      sourceType,
      sourceId,
      status: 'SCHEDULED'
    },
    data: {
      status: 'CANCELLED',
      error: 'rescheduled'
    }
  });

  const job = await prisma.assistantScheduledAlert.create({
    data: {
      userId,
      sourceType,
      sourceId,
      scheduledFor,
      timezone,
      version,
      status: 'SCHEDULED',
      payload: payload as Prisma.JsonObject
    }
  });

  try {
    const published = await publishScheduledAlertToN8n(job);
    const externalJobId = asString(published.jobId || published.executionId || published.id);
    if (externalJobId) {
      await prisma.assistantScheduledAlert.update({
        where: { id: job.id },
        data: { externalJobId }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scheduler error';
    await prisma.assistantScheduledAlert.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        error: message
      }
    });
    await logAssistantAction(userId, 'schedule_personal_alert', 'FAILED', `No se pudo programar ${sourceType.toLowerCase()}`, {
      sourceType,
      sourceId,
      scheduledFor,
      error: message
    }, 'APP');
  }

  return job;
}

async function cancelScheduledPersonalAlerts(sourceType: ScheduledAlertSourceType, sourceId: string, reason: string) {
  await prisma.assistantScheduledAlert.updateMany({
    where: {
      sourceType,
      sourceId,
      status: { in: ['SCHEDULED', 'FAILED'] }
    },
    data: {
      status: 'CANCELLED',
      error: reason
    }
  });
}

export async function findPersonalContact(userId: string, payload: Record<string, unknown>) {
  const contactId = asString(payload.contactId);
  if (contactId) {
    const contact = await prisma.personalContact.findFirst({ where: { id: contactId, userId } });
    if (contact) return contact;
  }

  const phone = phoneFromPayload(payload);
  if (phone) {
    const contact = await prisma.personalContact.findFirst({ where: { userId, phone } });
    if (contact) return contact;
  }

  const name = asString(payload.contactName || payload.name || payload.to);
  if (!name) return null;

  const exactMatch = await prisma.personalContact.findFirst({
    where: {
      userId,
      OR: [
        { name: { contains: name, mode: 'insensitive' } },
        { alias: { contains: name, mode: 'insensitive' } }
      ]
    },
    orderBy: { updatedAt: 'desc' }
  });
  if (exactMatch) return exactMatch;

  const requested = normalizeSearchText(name);
  const requestedTokens = searchableTokens(name);
  if (!requested && requestedTokens.length === 0) return null;

  const contacts = await prisma.personalContact.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 200
  });

  const scored = contacts
    .map((contact) => {
      const haystack = normalizeSearchText([
        contact.name,
        contact.alias,
        contact.relation
      ].filter(Boolean).join(' '));
      const haystackTokens = searchableTokens(haystack);
      let score = 0;

      if (haystack === requested) score += 100;
      if (requested && haystack.includes(requested)) score += 40;
      for (const token of requestedTokens) {
        if (haystackTokens.includes(token)) score += 12;
        else if (haystack.includes(token)) score += 6;
      }

      return { contact, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  const [best, second] = scored;
  if (second && best.score === second.score) return null;
  return best.contact;
}

export async function getPersonalAssistantOverview(userId: string, options: PersonalOverviewOptions = {}) {
  const timeZone = options.timeZone || PERSONAL_DEFAULT_TIMEZONE;
  const referenceDate = options.referenceDate || new Date();
  const todayKey = dateKeyFromDate(referenceDate, timeZone);
  const startKey = shiftDateKey(todayKey, -(options.daysBack ?? 14));
  const endKey = shiftDateKey(todayKey, options.daysAhead ?? 45);
  const rangeStart = startOfDateKeyUtc(startKey);
  const rangeEnd = endOfDateKeyUtc(endKey);

  const [contacts, reminders, tasks, events, outboundMessages, actionLogs, alertPreference] = await Promise.all([
    prisma.personalContact.findMany({
      where: { userId },
      orderBy: [{ name: 'asc' }],
      take: 100
    }),
    prisma.personalReminder.findMany({
      where: {
        userId,
        status: { not: 'CANCELLED' },
        OR: [
          { status: 'PENDING', remindAt: { lte: rangeEnd } },
          { remindAt: { gte: rangeStart, lte: rangeEnd } }
        ]
      },
      orderBy: { remindAt: 'asc' },
      take: 100
    }),
    prisma.personalTask.findMany({
      where: {
        userId,
        status: { not: 'CANCELLED' },
        OR: [
          { dueAt: null },
          { status: { in: ['PENDING', 'IN_PROGRESS'] }, dueAt: { lt: rangeStart } },
          { dueAt: { gte: rangeStart, lte: rangeEnd } }
        ]
      },
      orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
      take: 100
    }),
    prisma.personalEvent.findMany({
      where: {
        userId,
        status: { not: 'CANCELLED' },
        startsAt: { gte: rangeStart, lte: rangeEnd }
      },
      orderBy: { startsAt: 'asc' },
      take: 100
    }),
    prisma.outboundMessage.findMany({
      where: { userId },
      orderBy: [{ scheduledAt: 'asc' }, { createdAt: 'desc' }],
      take: 50,
      include: { contact: true }
    }),
    prisma.assistantActionLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25
    }),
    prisma.alertPreference.findUnique({ where: { userId } })
  ]);

  const financialAlerts = await getPendingAlertsForUser(userId, {
    referenceDate,
    timeZone: normalizeAlertPreference(alertPreference).timezone,
    daysBack: 365,
    daysAhead: Math.max(options.daysAhead ?? 45, 1)
  });

  const todayStart = startOfDateKeyUtc(todayKey);
  const todayEnd = endOfDateKeyUtc(todayKey);
  const isToday = (date: Date | null) => date ? date >= todayStart && date <= todayEnd : false;
  const isOverdue = (date: Date | null) => date ? date < todayStart : false;

  const summary = {
    todayKey,
    contactsCount: contacts.length,
    remindersToday: reminders.filter((item) => isToday(item.remindAt)).length,
    tasksPending: tasks.filter((item) => item.status !== 'DONE').length,
    tasksOverdue: tasks.filter((item) => item.status !== 'DONE' && isOverdue(item.dueAt)).length,
    eventsToday: events.filter((item) => isToday(item.startsAt)).length,
    messagesPending: outboundMessages.filter((item) => item.status === 'DRAFT' || item.status === 'SCHEDULED').length,
    financialDueToday: financialAlerts.items.filter((item) => item.daysUntilDue === 0).length,
    financialOverdue: financialAlerts.items.filter((item) => item.daysUntilDue < 0).length,
    financialAmountToday: financialAlerts.items
      .filter((item) => item.daysUntilDue === 0)
      .reduce((total, item) => total + item.amount, 0)
  };

  return {
    todayKey,
    timeZone,
    summary,
    contacts,
    reminders,
    tasks,
    events,
    outboundMessages,
    actionLogs,
    financialAlerts
  };
}

export async function createPersonalContact(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const name = asString(payload.name || payload.contactName);
  const phone = phoneFromPayload(payload);
  if (!name) throw new Error('El nombre del contacto es obligatorio.');
  if (!phone) throw new Error('El telefono del contacto es obligatorio.');

  const contact = await prisma.personalContact.upsert({
    where: { userId_phone: { userId, phone } },
    update: {
      name,
      alias: asString(payload.alias) || null,
      relation: asString(payload.relation) || null,
      notes: asString(payload.notes) || null
    },
    create: {
      userId,
      name,
      phone,
      alias: asString(payload.alias) || null,
      relation: asString(payload.relation) || null,
      notes: asString(payload.notes) || null
    }
  });

  await logAssistantAction(userId, 'create_personal_contact', 'SUCCESS', `Contacto guardado: ${contact.name}`, payload, source);
  return contact;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    const next = clean[index + 1];
    if (char === '"' && next === '"') {
      current += '""';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '\n' && !inQuotes) {
      if (current.trim()) rows.push(parseCsvLine(current));
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) rows.push(parseCsvLine(current));
  return rows;
}

function csvValue(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = asString(row[name]);
    if (value) return value;
  }
  return '';
}

function phoneValues(row: Record<string, string>) {
  return Object.entries(row)
    .filter(([key, value]) => /phone/i.test(key) && /value/i.test(key) && asString(value))
    .flatMap(([, value]) => value.split(/\s*:::\s*|\s*;\s*/))
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function importGoogleContactsCsv(userId: string, csvText: string, source: AssistantSource = 'APP'): Promise<ImportContactsResult> {
  if (!asString(csvText)) {
    throw new Error('El archivo CSV esta vacio.');
  }

  const rows = parseCsv(csvText);
  const [headers, ...dataRows] = rows;
  if (!headers?.length || dataRows.length === 0) {
    throw new Error('No pude leer contactos desde el CSV.');
  }

  const seenPhones = new Set<string>();
  const imported: ImportContactsResult['contacts'] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let invalid = 0;

  for (const values of dataRows) {
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    const displayName = csvValue(row, ['Name', 'Nombre']);
    const givenName = csvValue(row, ['Given Name', 'Nombre de pila']);
    const familyName = csvValue(row, ['Family Name', 'Apellidos']);
    const name = displayName || [givenName, familyName].filter(Boolean).join(' ').trim();
    const relation = csvValue(row, ['Organization 1 - Name', 'Organization 1 - Title', 'Empresa']);
    const notes = csvValue(row, ['Notes', 'Notas']);
    const phones = phoneValues(row);

    if (!name || phones.length === 0) {
      invalid += 1;
      continue;
    }

    for (const rawPhone of phones) {
      const phone = normalizeWhatsappPhone(rawPhone);
      if (!phone) {
        invalid += 1;
        continue;
      }
      if (seenPhones.has(phone)) {
        skipped += 1;
        continue;
      }
      seenPhones.add(phone);

      const existing = await prisma.personalContact.findUnique({
        where: { userId_phone: { userId, phone } },
        select: { id: true }
      });

      const contact = await prisma.personalContact.upsert({
        where: { userId_phone: { userId, phone } },
        update: {
          name,
          relation: relation || null,
          notes: notes || null
        },
        create: {
          userId,
          name,
          phone,
          relation: relation || null,
          notes: notes || null
        },
        select: {
          id: true,
          name: true,
          phone: true
        }
      });

      if (existing) updated += 1;
      else created += 1;
      imported.push(contact);
    }
  }

  await logAssistantAction(
    userId,
    'import_google_contacts_csv',
    'SUCCESS',
    `Contactos importados: ${created} nuevos, ${updated} actualizados`,
    { created, updated, skipped, invalid, totalRows: dataRows.length },
    source
  );

  return {
    created,
    updated,
    skipped,
    invalid,
    totalRows: dataRows.length,
    contacts: imported.slice(0, 50)
  };
}

export async function createPersonalReminder(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const title = asString(payload.title || payload.description);
  const remindAt = asDate(payload.remindAt || payload.date || payload.datetime);
  if (!title) throw new Error('El titulo del recordatorio es obligatorio.');
  if (!remindAt) throw new Error('La fecha y hora del recordatorio son obligatorias.');

  const reminder = await prisma.personalReminder.create({
    data: {
      userId,
      title,
      description: asString(payload.description) || null,
      remindAt,
      priority: normalizePriority(payload.priority),
      channel: asString(payload.channel).toUpperCase() || PERSONAL_CHANNEL_WHATSAPP,
      recurrence: asString(payload.recurrence) || null,
      status: normalizeReminderStatus(payload.status)
    }
  });

  await logAssistantAction(userId, 'create_personal_reminder', 'SUCCESS', `Recordatorio creado: ${reminder.title}`, payload, source);
  if (reminder.status === 'PENDING' && reminder.channel === PERSONAL_CHANNEL_WHATSAPP) {
    await schedulePersonalAlert(userId, 'REMINDER', reminder.id, reminder.remindAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: reminder.title,
      source
    });
  }
  return reminder;
}

export async function createPersonalTask(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const title = asString(payload.title || payload.task || payload.description);
  if (!title) throw new Error('El titulo de la tarea es obligatorio.');

  const task = await prisma.personalTask.create({
    data: {
      userId,
      title,
      description: asString(payload.description) || null,
      dueAt: asDate(payload.dueAt || payload.date || payload.datetime),
      priority: normalizePriority(payload.priority),
      status: normalizeTaskStatus(payload.status),
      tags: asString(payload.tags) || null
    }
  });

  await logAssistantAction(userId, 'create_personal_task', 'SUCCESS', `Tarea creada: ${task.title}`, payload, source);
  return task;
}

export async function createPersonalEvent(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const title = asString(payload.title || payload.event || payload.description);
  const startsAt = asDate(payload.startsAt || payload.date || payload.datetime);
  if (!title) throw new Error('El titulo del evento es obligatorio.');
  if (!startsAt) throw new Error('La fecha y hora del evento son obligatorias.');

  const event = await prisma.personalEvent.create({
    data: {
      userId,
      title,
      description: asString(payload.description) || null,
      location: asString(payload.location) || null,
      startsAt,
      endsAt: asDate(payload.endsAt || payload.endDate),
      participants: asString(payload.participants) || null,
      status: normalizeEventStatus(payload.status)
    }
  });

  await logAssistantAction(userId, 'create_personal_event', 'SUCCESS', `Evento creado: ${event.title}`, payload, source);
  if (event.status === 'SCHEDULED') {
    await schedulePersonalAlert(userId, 'EVENT', event.id, event.startsAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: event.title,
      source
    });
  }
  return event;
}

export async function updatePersonalTask(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.taskId);
  if (!id) throw new Error('El id de la tarea es obligatorio.');

  const existing = await prisma.personalTask.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro la tarea para este usuario.');

  const title = hasPayloadValue(payload, 'title') ? asString(payload.title) : existing.title;
  if (!title) throw new Error('El titulo de la tarea es obligatorio.');

  const dueAtWasSent = hasPayloadValue(payload, 'dueAt') || hasPayloadValue(payload, 'date') || hasPayloadValue(payload, 'datetime');
  const task = await prisma.personalTask.update({
    where: { id: existing.id },
    data: {
      title,
      description: hasPayloadValue(payload, 'description') ? asString(payload.description) || null : existing.description,
      dueAt: dueAtWasSent ? asDate(payload.dueAt || payload.date || payload.datetime) : existing.dueAt,
      priority: hasPayloadValue(payload, 'priority') ? normalizePriority(payload.priority) : existing.priority,
      status: hasPayloadValue(payload, 'status') ? normalizeTaskStatus(payload.status) : existing.status,
      tags: hasPayloadValue(payload, 'tags') ? asString(payload.tags) || null : existing.tags
    }
  });

  await logAssistantAction(userId, 'update_personal_task', 'SUCCESS', `Tarea editada: ${task.title}`, payload, source);
  return task;
}

export async function updatePersonalTaskStatus(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.taskId);
  const status = normalizeTaskStatus(payload.status);

  let existing = id ? await prisma.personalTask.findFirst({ where: { id, userId } }) : null;
  if (!existing) {
    const query = asString(payload.query || payload.title || payload.task || payload.description);
    if (query) {
      const candidates = await prisma.personalTask.findMany({
        where: { userId, status: { not: 'CANCELLED' } },
        orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
        take: 100
      });
      existing = bestTitleMatch(candidates, query);
    }
  }
  if (!existing) {
    throw new Error('No se encontro una tarea clara para actualizar.');
  }

  const task = await prisma.personalTask.update({
    where: { id: existing.id },
    data: { status }
  });

  await logAssistantAction(userId, 'update_personal_task', 'SUCCESS', `Tarea actualizada: ${task.title}`, payload, source);
  return task;
}

export async function postponePersonalTask(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.taskId);
  if (!id) throw new Error('El id de la tarea es obligatorio.');

  const minutes = Number(payload.minutes || 0);
  const hours = Number(payload.hours || 0);
  const days = Number(payload.days || 0);
  const explicitDate = asDate(payload.dueAt || payload.datetime);

  const existing = await prisma.personalTask.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro la tarea para este usuario.');

  const nextDate = explicitDate || new Date(existing.dueAt || new Date());
  if (!explicitDate) {
    nextDate.setMinutes(nextDate.getMinutes() + (Number.isFinite(minutes) ? minutes : 0));
    nextDate.setHours(nextDate.getHours() + (Number.isFinite(hours) ? hours : 0));
    nextDate.setDate(nextDate.getDate() + (Number.isFinite(days) ? days : 0));
  }

  if (nextDate <= new Date()) {
    const fallbackDate = new Date();
    fallbackDate.setMinutes(fallbackDate.getMinutes() + 30);
    nextDate.setTime(fallbackDate.getTime());
  }

  const task = await prisma.personalTask.update({
    where: { id: existing.id },
    data: { dueAt: nextDate }
  });

  await logAssistantAction(userId, 'postpone_personal_task', 'SUCCESS', `Tarea pospuesta: ${task.title}`, payload, source);
  return task;
}

export async function updatePersonalReminder(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.reminderId);
  if (!id) throw new Error('El id del recordatorio es obligatorio.');

  const existing = await prisma.personalReminder.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro el recordatorio para este usuario.');

  const title = hasPayloadValue(payload, 'title') ? asString(payload.title) : existing.title;
  const remindAtWasSent = hasPayloadValue(payload, 'remindAt') || hasPayloadValue(payload, 'date') || hasPayloadValue(payload, 'datetime');
  const remindAt = remindAtWasSent ? asDate(payload.remindAt || payload.date || payload.datetime) : existing.remindAt;
  if (!title) throw new Error('El titulo del recordatorio es obligatorio.');
  if (!remindAt) throw new Error('La fecha y hora del recordatorio son obligatorias.');

  const reminder = await prisma.personalReminder.update({
    where: { id: existing.id },
    data: {
      title,
      description: hasPayloadValue(payload, 'description') ? asString(payload.description) || null : existing.description,
      remindAt,
      priority: hasPayloadValue(payload, 'priority') ? normalizePriority(payload.priority) : existing.priority,
      channel: hasPayloadValue(payload, 'channel') ? asString(payload.channel).toUpperCase() || PERSONAL_CHANNEL_WHATSAPP : existing.channel,
      recurrence: hasPayloadValue(payload, 'recurrence') ? asString(payload.recurrence) || null : existing.recurrence,
      status: hasPayloadValue(payload, 'status') ? normalizeReminderStatus(payload.status) : existing.status
    }
  });

  if (reminder.status === 'PENDING' && reminder.channel === PERSONAL_CHANNEL_WHATSAPP) {
    await schedulePersonalAlert(userId, 'REMINDER', reminder.id, reminder.remindAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: reminder.title,
      source
    });
  } else {
    await cancelScheduledPersonalAlerts('REMINDER', reminder.id, `status_${reminder.status.toLowerCase()}`);
  }

  await logAssistantAction(userId, 'update_personal_reminder', 'SUCCESS', `Recordatorio editado: ${reminder.title}`, payload, source);
  return reminder;
}

export async function updatePersonalReminderStatus(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.reminderId);
  const status = normalizeReminderStatus(payload.status);

  let existing = id ? await prisma.personalReminder.findFirst({ where: { id, userId } }) : null;
  if (!existing) {
    const query = asString(payload.query || payload.title || payload.reminder || payload.description);
    if (query) {
      const candidates = await prisma.personalReminder.findMany({
        where: { userId, status: { not: 'CANCELLED' } },
        orderBy: { remindAt: 'asc' },
        take: 100
      });
      existing = bestTitleMatch(candidates, query);
    }
  }
  if (!existing) {
    throw new Error('No se encontro un recordatorio claro para actualizar.');
  }

  const reminder = await prisma.personalReminder.update({
    where: { id: existing.id },
    data: { status }
  });

  if (status === 'PENDING' && reminder.channel === PERSONAL_CHANNEL_WHATSAPP) {
    await schedulePersonalAlert(userId, 'REMINDER', reminder.id, reminder.remindAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: reminder.title,
      source
    });
  } else {
    await cancelScheduledPersonalAlerts('REMINDER', reminder.id, `status_${status.toLowerCase()}`);
  }

  await logAssistantAction(userId, 'update_personal_reminder', 'SUCCESS', `Recordatorio actualizado: ${reminder.title}`, payload, source);
  return reminder;
}

export async function postponePersonalReminder(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.reminderId);
  if (!id) throw new Error('El id del recordatorio es obligatorio.');

  const minutes = Number(payload.minutes || 0);
  const hours = Number(payload.hours || 0);
  const days = Number(payload.days || 0);
  const explicitDate = asDate(payload.remindAt || payload.datetime);

  const existing = await prisma.personalReminder.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro el recordatorio para este usuario.');

  const nextDate = explicitDate || new Date(existing.remindAt);
  if (!explicitDate) {
    nextDate.setMinutes(nextDate.getMinutes() + (Number.isFinite(minutes) ? minutes : 0));
    nextDate.setHours(nextDate.getHours() + (Number.isFinite(hours) ? hours : 0));
    nextDate.setDate(nextDate.getDate() + (Number.isFinite(days) ? days : 0));
  }

  if (nextDate <= new Date()) {
    const fallbackDate = new Date();
    fallbackDate.setMinutes(fallbackDate.getMinutes() + 30);
    nextDate.setTime(fallbackDate.getTime());
  }

  const reminder = await prisma.personalReminder.update({
    where: { id: existing.id },
    data: {
      remindAt: nextDate,
      status: 'PENDING'
    }
  });

  if (reminder.channel === PERSONAL_CHANNEL_WHATSAPP) {
    await schedulePersonalAlert(userId, 'REMINDER', reminder.id, reminder.remindAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: reminder.title,
      source,
      postponed: true
    });
  }

  await logAssistantAction(userId, 'postpone_personal_reminder', 'SUCCESS', `Recordatorio pospuesto: ${reminder.title}`, payload, source);
  return reminder;
}

export async function updatePersonalEvent(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.eventId);
  if (!id) throw new Error('El id del evento es obligatorio.');

  const existing = await prisma.personalEvent.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro el evento para este usuario.');

  const title = hasPayloadValue(payload, 'title') ? asString(payload.title) : existing.title;
  const startsAtWasSent = hasPayloadValue(payload, 'startsAt') || hasPayloadValue(payload, 'date') || hasPayloadValue(payload, 'datetime');
  const startsAt = startsAtWasSent ? asDate(payload.startsAt || payload.date || payload.datetime) : existing.startsAt;
  if (!title) throw new Error('El titulo del evento es obligatorio.');
  if (!startsAt) throw new Error('La fecha y hora del evento son obligatorias.');

  const endsAtWasSent = hasPayloadValue(payload, 'endsAt') || hasPayloadValue(payload, 'endDate');
  const event = await prisma.personalEvent.update({
    where: { id: existing.id },
    data: {
      title,
      description: hasPayloadValue(payload, 'description') ? asString(payload.description) || null : existing.description,
      location: hasPayloadValue(payload, 'location') ? asString(payload.location) || null : existing.location,
      startsAt,
      endsAt: endsAtWasSent ? asDate(payload.endsAt || payload.endDate) : existing.endsAt,
      participants: hasPayloadValue(payload, 'participants') ? asString(payload.participants) || null : existing.participants,
      status: hasPayloadValue(payload, 'status') ? normalizeEventStatus(payload.status) : existing.status
    }
  });

  if (event.status === 'SCHEDULED') {
    await schedulePersonalAlert(userId, 'EVENT', event.id, event.startsAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: event.title,
      source
    });
  } else {
    await cancelScheduledPersonalAlerts('EVENT', event.id, `status_${event.status.toLowerCase()}`);
  }

  await logAssistantAction(userId, 'update_personal_event', 'SUCCESS', `Evento editado: ${event.title}`, payload, source);
  return event;
}

export async function updatePersonalEventStatus(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.eventId);
  if (!id) throw new Error('El id del evento es obligatorio.');

  const existing = await prisma.personalEvent.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro el evento para este usuario.');

  const status = normalizeEventStatus(payload.status);
  const event = await prisma.personalEvent.update({
    where: { id: existing.id },
    data: { status }
  });

  if (status === 'SCHEDULED') {
    await schedulePersonalAlert(userId, 'EVENT', event.id, event.startsAt, PERSONAL_DEFAULT_TIMEZONE, {
      title: event.title,
      source
    });
  } else {
    await cancelScheduledPersonalAlerts('EVENT', event.id, `status_${status.toLowerCase()}`);
  }

  await logAssistantAction(userId, 'update_personal_event', 'SUCCESS', `Evento actualizado: ${event.title}`, payload, source);
  return event;
}

export async function postponePersonalEvent(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const id = asString(payload.id || payload.eventId);
  if (!id) throw new Error('El id del evento es obligatorio.');

  const minutes = Number(payload.minutes || 0);
  const hours = Number(payload.hours || 0);
  const days = Number(payload.days || 0);
  const explicitDate = asDate(payload.startsAt || payload.datetime);

  const existing = await prisma.personalEvent.findFirst({ where: { id, userId } });
  if (!existing) throw new Error('No se encontro el evento para este usuario.');

  const previousStart = new Date(existing.startsAt);
  const nextStart = explicitDate || new Date(existing.startsAt);
  if (!explicitDate) {
    nextStart.setMinutes(nextStart.getMinutes() + (Number.isFinite(minutes) ? minutes : 0));
    nextStart.setHours(nextStart.getHours() + (Number.isFinite(hours) ? hours : 0));
    nextStart.setDate(nextStart.getDate() + (Number.isFinite(days) ? days : 0));
  }

  if (nextStart <= new Date()) {
    const fallbackDate = new Date();
    fallbackDate.setMinutes(fallbackDate.getMinutes() + 30);
    nextStart.setTime(fallbackDate.getTime());
  }

  const deltaMs = nextStart.getTime() - previousStart.getTime();
  const nextEnd = existing.endsAt ? new Date(existing.endsAt.getTime() + deltaMs) : null;
  const event = await prisma.personalEvent.update({
    where: { id: existing.id },
    data: {
      startsAt: nextStart,
      endsAt: nextEnd,
      status: 'SCHEDULED'
    }
  });

  await schedulePersonalAlert(userId, 'EVENT', event.id, event.startsAt, PERSONAL_DEFAULT_TIMEZONE, {
    title: event.title,
    source,
    postponed: true
  });

  await logAssistantAction(userId, 'postpone_personal_event', 'SUCCESS', `Evento pospuesto: ${event.title}`, payload, source);
  return event;
}

export type PersonalItemKind = 'task' | 'reminder' | 'event';

export interface PersonalItemCandidate {
  id: string;
  kind: PersonalItemKind;
  title: string;
  date: Date | null;
  status: string;
  description: string | null;
  location?: string | null;
  participants?: string | null;
  score: number;
}

function personalTargetQuery(payload: Record<string, unknown>, kind: PersonalItemKind) {
  const kindValue = kind === 'task'
    ? payload.task
    : kind === 'reminder'
      ? payload.reminder
      : payload.event;

  return asString(
    payload.query ||
    payload.target ||
    payload.targetTitle ||
    payload.currentTitle ||
    payload.originalTitle ||
    kindValue ||
    payload.title
  );
}

function scorePersonalCandidate(item: {
  title: string;
  description?: string | null;
  location?: string | null;
  participants?: string | null;
}, query: string) {
  const requested = normalizeSearchText(query);
  const requestedTokens = searchableTokens(query);
  if (!requested && requestedTokens.length === 0) return 1;

  const haystack = normalizeSearchText([
    item.title,
    item.description,
    item.location,
    item.participants
  ].filter(Boolean).join(' '));
  const haystackTokens = searchableTokens(haystack);
  let score = 0;

  if (haystack === requested) score += 100;
  if (requested && haystack.includes(requested)) score += 40;
  for (const token of requestedTokens) {
    if (haystackTokens.includes(token)) score += 12;
    else if (haystack.includes(token)) score += 6;
  }

  return score;
}

export async function findPersonalItemCandidates(
  userId: string,
  kind: PersonalItemKind,
  payload: Record<string, unknown>
): Promise<PersonalItemCandidate[]> {
  const id = asString(payload.id || payload.taskId || payload.reminderId || payload.eventId);
  const query = personalTargetQuery(payload, kind);
  const timeZone = asString(payload.timeZone) || PERSONAL_DEFAULT_TIMEZONE;
  const referenceDate = asDate(payload.referenceDate) || new Date();
  const range = searchDateRange(payload, timeZone, referenceDate);
  const dateFilter = range.start && range.end ? { gte: range.start, lte: range.end } : undefined;
  const includeCompleted = payload.includeCompleted === true || payload.includeDone === true;

  if (kind === 'task') {
    const tasks = await prisma.personalTask.findMany({
      where: {
        userId,
        ...(id ? { id } : {}),
        status: includeCompleted ? { not: 'CANCELLED' } : { in: ['PENDING', 'IN_PROGRESS'] },
        ...(dateFilter ? { dueAt: dateFilter } : {})
      },
      orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
      take: 25
    });

    return tasks
      .map((task) => ({
        id: task.id,
        kind,
        title: task.title,
        date: task.dueAt,
        status: task.status,
        description: task.description,
        score: id ? 100 : scorePersonalCandidate(task, query)
      }))
      .filter((candidate) => id || !query || candidate.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  if (kind === 'reminder') {
    const reminders = await prisma.personalReminder.findMany({
      where: {
        userId,
        ...(id ? { id } : {}),
        status: includeCompleted ? { not: 'CANCELLED' } : 'PENDING',
        ...(dateFilter ? { remindAt: dateFilter } : {})
      },
      orderBy: { remindAt: 'asc' },
      take: 25
    });

    return reminders
      .map((reminder) => ({
        id: reminder.id,
        kind,
        title: reminder.title,
        date: reminder.remindAt,
        status: reminder.status,
        description: reminder.description,
        score: id ? 100 : scorePersonalCandidate(reminder, query)
      }))
      .filter((candidate) => id || !query || candidate.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  const events = await prisma.personalEvent.findMany({
    where: {
      userId,
      ...(id ? { id } : {}),
      status: includeCompleted ? { not: 'CANCELLED' } : 'SCHEDULED',
      ...(dateFilter ? { startsAt: dateFilter } : {})
    },
    orderBy: { startsAt: 'asc' },
    take: 25
  });

  return events
    .map((event) => ({
      id: event.id,
      kind,
      title: event.title,
      date: event.startsAt,
      status: event.status,
      description: event.description,
      location: event.location,
      participants: event.participants,
      score: id ? 100 : scorePersonalCandidate(event, query)
    }))
    .filter((candidate) => id || !query || candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

export async function createOutboundMessage(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  const text = asString(payload.text || payload.message || payload.body);
  if (!text) throw new Error('El texto del mensaje es obligatorio.');

  const contact = await findPersonalContact(userId, payload);
  const phone = phoneFromPayload(payload) || contact?.phone || '';
  if (!phone) throw new Error('No pude resolver el telefono del destinatario.');

  const scheduledAt = asDate(payload.scheduledAt || payload.sendAt || payload.datetime);
  const message = await prisma.outboundMessage.create({
    data: {
      userId,
      contactId: contact?.id || null,
      phone,
      contactName: contact?.name || asString(payload.contactName || payload.to) || null,
      text,
      scheduledAt,
      status: scheduledAt ? 'SCHEDULED' : 'DRAFT'
    }
  });

  await logAssistantAction(userId, 'create_outbound_message', 'SUCCESS', `Mensaje preparado para ${message.contactName || message.phone}`, payload, source);
  if (message.status === 'SCHEDULED' && message.scheduledAt) {
    await schedulePersonalAlert(userId, 'MESSAGE', message.id, message.scheduledAt, PERSONAL_DEFAULT_TIMEZONE, {
      contactName: message.contactName,
      source
    });
  }
  return message;
}

export async function sendTextViaEvolution(phone: string, text: string) {
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
      delay: 1200
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Evolution send failed (${response.status}): ${responseText}`);
  }

  let data: Record<string, unknown> = {};
  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }
  }

  const providerStatus = asString(data.status).toUpperCase();
  if (providerStatus && ['ERROR', 'FAILED', 'REJECTED'].includes(providerStatus)) {
    throw new Error(`Evolution rejected message: ${responseText}`);
  }

  return { response, data, number };
}

async function sendPersonalWebhook(payload: Record<string, unknown>) {
  const url = process.env.N8N_ALERT_WEBHOOK_URL?.trim() || process.env.N8N_WEBHOOK_URL?.trim();
  if (!url) {
    throw new Error('No WhatsApp sender is configured');
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
    throw new Error(`Personal webhook failed (${response.status}): ${text}`);
  }

  return response;
}

async function sendPersonalWhatsApp(phone: string, text: string, payload: Record<string, unknown>) {
  if (process.env.EVOLUTION_BASE_URL?.trim() && process.env.EVOLUTION_INSTANCE?.trim() && process.env.EVOLUTION_API_KEY?.trim()) {
    return sendTextViaEvolution(phone, text);
  }

  return sendPersonalWebhook({
    phone,
    text,
    source: 'personal-assistant',
    ...payload
  });
}

export async function sendScheduledPersonalAlert(payload: Record<string, unknown>) {
  const scheduledAlertId = asString(payload.scheduledAlertId || payload.id);
  if (!scheduledAlertId) throw new Error('scheduledAlertId is required');

  const job = await prisma.assistantScheduledAlert.findUnique({
    where: { id: scheduledAlertId },
    include: {
      user: { include: { alertPreference: true } }
    }
  });

  if (!job) throw new Error('Scheduled alert not found');
  if (job.status !== 'SCHEDULED') {
    return { sent: false, reason: `job_${job.status.toLowerCase()}`, job };
  }

  const now = new Date();
  if (job.scheduledFor > minutesAfter(now, PERSONAL_SCHEDULE_GRACE_MINUTES)) {
    await prisma.assistantScheduledAlert.update({
      where: { id: job.id },
      data: { status: 'SKIPPED', error: 'called_before_scheduled_time' }
    });
    return { sent: false, reason: 'too_early', job };
  }

  const latest = await prisma.assistantScheduledAlert.findFirst({
    where: {
      sourceType: job.sourceType,
      sourceId: job.sourceId
    },
    orderBy: { version: 'desc' }
  });

  if (latest && latest.id !== job.id) {
    await prisma.assistantScheduledAlert.update({
      where: { id: job.id },
      data: { status: 'SKIPPED', error: 'superseded_by_newer_version' }
    });
    return { sent: false, reason: 'superseded', job };
  }

  const preference = normalizeAlertPreference(job.user.alertPreference);
  if (!preference.enabled || !preference.phone) {
    await prisma.assistantScheduledAlert.update({
      where: { id: job.id },
      data: { status: 'SKIPPED', error: !preference.enabled ? 'alerts_disabled' : 'missing_phone' }
    });
    return { sent: false, reason: !preference.enabled ? 'disabled' : 'missing_phone', job };
  }

  try {
    if (job.sourceType === 'REMINDER') {
      const reminder = await prisma.personalReminder.findFirst({
        where: {
          id: job.sourceId,
          userId: job.userId
        }
      });
      if (!reminder || reminder.status !== 'PENDING' || reminder.channel !== PERSONAL_CHANNEL_WHATSAPP) {
        await prisma.assistantScheduledAlert.update({
          where: { id: job.id },
          data: { status: 'SKIPPED', error: 'reminder_not_pending' }
        });
        return { sent: false, reason: 'reminder_not_pending', job };
      }

      const text = buildReminderMessage(reminder.title, reminder.description, reminder.remindAt, preference.timezone);
      await sendPersonalWhatsApp(preference.phone, text, { type: 'reminder', reminderId: reminder.id, scheduledAlertId: job.id });
      await logAssistantAction(job.userId, 'dispatch_personal_reminder', 'SUCCESS', `Recordatorio enviado: ${reminder.title}`, {
        reminderId: reminder.id,
        scheduledAlertId: job.id,
        version: job.version
      }, 'CRON');
    } else if (job.sourceType === 'EVENT') {
      const event = await prisma.personalEvent.findFirst({
        where: {
          id: job.sourceId,
          userId: job.userId
        }
      });
      if (!event || event.status !== 'SCHEDULED') {
        await prisma.assistantScheduledAlert.update({
          where: { id: job.id },
          data: { status: 'SKIPPED', error: 'event_not_scheduled' }
        });
        return { sent: false, reason: 'event_not_scheduled', job };
      }

      const text = buildEventMessage(event, preference.timezone);
      await sendPersonalWhatsApp(preference.phone, text, { type: 'event', eventId: event.id, scheduledAlertId: job.id });
      await logAssistantAction(job.userId, 'dispatch_personal_event', 'SUCCESS', `Evento enviado: ${event.title}`, {
        eventId: event.id,
        scheduledAlertId: job.id,
        version: job.version
      }, 'CRON');
    } else if (job.sourceType === 'MESSAGE') {
      const message = await prisma.outboundMessage.findFirst({
        where: {
          id: job.sourceId,
          userId: job.userId
        }
      });
      if (!message || message.status !== 'SCHEDULED') {
        await prisma.assistantScheduledAlert.update({
          where: { id: job.id },
          data: { status: 'SKIPPED', error: 'message_not_scheduled' }
        });
        return { sent: false, reason: 'message_not_scheduled', job };
      }

      await sendPersonalWhatsApp(message.phone, message.text, { type: 'scheduled_message', messageId: message.id, scheduledAlertId: job.id });
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: 'SENT', sentAt: now, error: null }
      });
      await logAssistantAction(job.userId, 'dispatch_scheduled_message', 'SUCCESS', `WhatsApp programado enviado a ${message.contactName || message.phone}`, {
        messageId: message.id,
        scheduledAlertId: job.id,
        version: job.version
      }, 'CRON');
    } else {
      await prisma.assistantScheduledAlert.update({
        where: { id: job.id },
        data: { status: 'SKIPPED', error: `unsupported_source_type_${job.sourceType}` }
      });
      return { sent: false, reason: 'unsupported_source_type', job };
    }

    const updated = await prisma.assistantScheduledAlert.update({
      where: { id: job.id },
      data: {
        status: 'SENT',
        sentAt: now,
        error: null
      }
    });

    return { sent: true, job: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scheduled send error';
    await prisma.assistantScheduledAlert.update({
      where: { id: job.id },
      data: {
        status: 'FAILED',
        error: message
      }
    });
    throw error;
  }
}

export async function sendOutboundMessageNow(userId: string, payload: Record<string, unknown>, source: AssistantSource = 'APP') {
  let messageId = asString(payload.messageId || payload.id);
  let message = messageId
    ? await prisma.outboundMessage.findFirst({ where: { id: messageId, userId } })
    : null;

  if (!message) {
    message = await createOutboundMessage(userId, payload, source);
    messageId = message.id;
  }

  try {
    const delivery = await sendTextViaEvolution(message.phone, message.text);
    const sent = await prisma.outboundMessage.update({
      where: { id: messageId },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        error: null
      }
    });
    await logAssistantAction(userId, 'send_outbound_message', 'SUCCESS', `WhatsApp enviado a ${sent.contactName || sent.phone} (${delivery.number})`, {
      ...payload,
      delivery: delivery.data
    }, source);
    return sent;
  } catch (error) {
    const failed = await prisma.outboundMessage.update({
      where: { id: messageId },
      data: {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Unknown send error'
      }
    });
    await logAssistantAction(userId, 'send_outbound_message', 'FAILED', `No se pudo enviar WhatsApp a ${failed.contactName || failed.phone}`, payload, source);
    throw error;
  }
}

function buildReminderMessage(title: string, description: string | null, remindAt: Date, timeZone: string) {
  return [
    `Recordatorio: ${title}`,
    `Fecha: ${displayDateTime(remindAt, timeZone)}`,
    description ? `Nota: ${description}` : '',
    'Se repetira cada dia hasta que lo marques como cumplido o cancelado.'
  ].filter(Boolean).join('\n');
}

function buildEventMessage(event: {
  title: string;
  description: string | null;
  location: string | null;
  participants: string | null;
  startsAt: Date;
}, timeZone: string) {
  return [
    `Agenda: ${event.title}`,
    `Fecha: ${displayDateTime(event.startsAt, timeZone)}`,
    event.location ? `Lugar: ${event.location}` : '',
    event.participants ? `Con: ${event.participants}` : '',
    event.description ? `Nota: ${event.description}` : ''
  ].filter(Boolean).join('\n');
}

function buildDailySummaryMessage(overview: Awaited<ReturnType<typeof getPersonalAssistantOverview>>, timeZone: string) {
  const todayTasks = overview.tasks.filter((item) => item.status !== 'DONE' && item.status !== 'CANCELLED').slice(0, 5);
  const todayReminders = overview.reminders.filter((item) => item.status === 'PENDING').slice(0, 5);
  const todayEvents = overview.events.filter((item) => item.status === 'SCHEDULED').slice(0, 5);
  const dueToday = overview.financialAlerts.items.filter((item) => item.daysUntilDue === 0);
  const overdue = overview.financialAlerts.items.filter((item) => item.daysUntilDue < 0);
  const financialTotal = dueToday.reduce((total, item) => total + item.amount, 0);

  return [
    `Resumen diario del asistente (${overview.todayKey})`,
    `Agenda: ${overview.summary.eventsToday} evento(s). Recordatorios: ${overview.summary.remindersToday}. Tareas pendientes: ${overview.summary.tasksPending}.`,
    overview.summary.financialDueToday > 0 ? `Vencimientos financieros de hoy: ${overview.summary.financialDueToday} por ${money(financialTotal)}.` : 'Sin vencimientos financieros para hoy.',
    overdue.length > 0 ? `Atencion: ${overdue.length} vencimiento(s) financiero(s) atrasado(s).` : '',
    todayEvents.length ? `Agenda:\n${todayEvents.map((item) => `- ${displayDateTime(item.startsAt, timeZone)}: ${item.title}`).join('\n')}` : '',
    todayReminders.length ? `Recordatorios:\n${todayReminders.map((item) => `- ${displayDateTime(item.remindAt, timeZone)}: ${item.title}`).join('\n')}` : '',
    todayTasks.length ? `Tareas:\n${todayTasks.map((item) => `- ${item.title}${item.dueAt ? ` (${displayDateTime(item.dueAt, timeZone)})` : ''}`).join('\n')}` : ''
  ].filter(Boolean).join('\n\n');
}

async function completeReminderAfterDispatch(reminder: {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  remindAt: Date;
  priority: string;
  channel: string;
  recurrence: string | null;
}) {
  const nextDate = addRecurrence(reminder.remindAt, reminder.recurrence);

  await prisma.$transaction(async (tx) => {
    await tx.personalReminder.update({
      where: { id: reminder.id },
      data: { status: 'DONE' }
    });

    if (nextDate) {
      await tx.personalReminder.create({
        data: {
          userId: reminder.userId,
          title: reminder.title,
          description: reminder.description,
          remindAt: nextDate,
          priority: reminder.priority,
          channel: reminder.channel,
          recurrence: reminder.recurrence,
          status: 'PENDING'
        }
      });
    }
  });
}

export async function dispatchPersonalAssistant(options: DispatchPersonalAssistantOptions = {}) {
  const referenceDate = options.referenceDate || new Date();
  const punctualWindowStart = minutesBefore(referenceDate, PERSONAL_DISPATCH_LOOKBACK_MINUTES);
  const users = await prisma.user.findMany({
    where: options.userId ? { id: options.userId } : undefined,
    include: { alertPreference: true }
  });

  const results = [];

  for (const user of users) {
    const preference = normalizeAlertPreference(user.alertPreference);
    const phone = preference.phone;
    const todayKey = dateKeyFromDate(referenceDate, preference.timezone);
    const todayStart = parseDateKey(todayKey);
    const todayEnd = new Date(`${todayKey}T23:59:59.999Z`);
    const isDailySummaryHour = hasReachedLocalHour(referenceDate, preference.notifyHour, preference.timezone);

    if (!preference.enabled || !phone) {
      results.push({ userId: user.id, sent: false, reason: !preference.enabled ? 'disabled' : 'missing_phone' });
      continue;
    }

    const dueReminders = await prisma.personalReminder.findMany({
      where: {
        userId: user.id,
        status: 'PENDING',
        channel: PERSONAL_CHANNEL_WHATSAPP,
        remindAt: { gte: punctualWindowStart, lte: referenceDate }
      },
      orderBy: { remindAt: 'asc' },
      take: 20
    });

    const reminderDispatchLogs = await prisma.assistantActionLog.findMany({
      where: {
        userId: user.id,
        action: 'dispatch_personal_reminder',
        createdAt: { gte: punctualWindowStart, lte: referenceDate }
      },
      select: { payload: true }
    });
    const remindersSentToday = new Set(
      reminderDispatchLogs
        .map((log) => {
          const payload = log.payload as { reminderId?: unknown } | null;
          return asString(payload?.reminderId);
        })
        .filter(Boolean)
    );
    const unsentDueReminders = dueReminders.filter((reminder) => !remindersSentToday.has(reminder.id));

    const dueEvents = await prisma.personalEvent.findMany({
      where: {
        userId: user.id,
        status: 'SCHEDULED',
        startsAt: { gte: punctualWindowStart, lte: referenceDate }
      },
      orderBy: { startsAt: 'asc' },
      take: 20
    });

    const eventDispatchLogs = await prisma.assistantActionLog.findMany({
      where: {
        userId: user.id,
        action: 'dispatch_personal_event',
        createdAt: { gte: punctualWindowStart, lte: referenceDate }
      },
      select: { payload: true }
    });
    const eventsSentToday = new Set(
      eventDispatchLogs
        .map((log) => {
          const payload = log.payload as { eventId?: unknown } | null;
          return asString(payload?.eventId);
        })
        .filter(Boolean)
    );
    const unsentDueEvents = dueEvents.filter((event) => !eventsSentToday.has(event.id));

    const dueMessages = await prisma.outboundMessage.findMany({
      where: {
        userId: user.id,
        status: 'SCHEDULED',
        scheduledAt: { gte: punctualWindowStart, lte: referenceDate }
      },
      orderBy: { scheduledAt: 'asc' },
      take: 20
    });

    const existingSummary = await prisma.assistantActionLog.findFirst({
      where: {
        userId: user.id,
        action: 'personal_daily_summary',
        createdAt: { gte: todayStart, lte: todayEnd }
      }
    });
    const shouldSendSummary = isDailySummaryHour && !existingSummary;

    const userResult = {
      userId: user.id,
      sent: false,
      dryRun: Boolean(options.dryRun),
      reminders: unsentDueReminders.length,
      events: unsentDueEvents.length,
      messages: dueMessages.length,
      dailySummary: shouldSendSummary
    };

    if (options.dryRun) {
      results.push(userResult);
      continue;
    }

    for (const reminder of unsentDueReminders) {
      const text = buildReminderMessage(reminder.title, reminder.description, reminder.remindAt, preference.timezone);
      await sendPersonalWhatsApp(phone, text, { type: 'reminder', reminderId: reminder.id });
      await logAssistantAction(user.id, 'dispatch_personal_reminder', 'SUCCESS', `Recordatorio enviado: ${reminder.title}`, { reminderId: reminder.id }, 'CRON');
      userResult.sent = true;
    }

    for (const event of unsentDueEvents) {
      const text = buildEventMessage(event, preference.timezone);
      await sendPersonalWhatsApp(phone, text, { type: 'event', eventId: event.id });
      await logAssistantAction(user.id, 'dispatch_personal_event', 'SUCCESS', `Evento enviado: ${event.title}`, { eventId: event.id }, 'CRON');
      userResult.sent = true;
    }

    for (const message of dueMessages) {
      try {
        await sendPersonalWhatsApp(message.phone, message.text, { type: 'scheduled_message', messageId: message.id });
        await prisma.outboundMessage.update({
          where: { id: message.id },
          data: { status: 'SENT', sentAt: new Date(), error: null }
        });
        await logAssistantAction(user.id, 'dispatch_scheduled_message', 'SUCCESS', `WhatsApp programado enviado a ${message.contactName || message.phone}`, { messageId: message.id }, 'CRON');
        userResult.sent = true;
      } catch (error) {
        await prisma.outboundMessage.update({
          where: { id: message.id },
          data: { status: 'FAILED', error: error instanceof Error ? error.message : 'Unknown send error' }
        });
        await logAssistantAction(user.id, 'dispatch_scheduled_message', 'FAILED', `No se pudo enviar WhatsApp programado a ${message.contactName || message.phone}`, { messageId: message.id }, 'CRON');
      }
    }

    if (shouldSendSummary) {
      const overview = await getPersonalAssistantOverview(user.id, {
        referenceDate,
        timeZone: preference.timezone,
        daysBack: 7,
        daysAhead: 1
      });
      const text = buildDailySummaryMessage(overview, preference.timezone);
      await sendPersonalWhatsApp(phone, text, { type: 'daily_summary', todayKey });
      await logAssistantAction(user.id, 'personal_daily_summary', 'SUCCESS', 'Resumen diario enviado', { todayKey }, 'CRON');
      userResult.sent = true;
    }

    results.push(userResult);
  }

  return {
    ok: true,
    runDate: referenceDate.toISOString(),
    results
  };
}

export function personalActionPreview(action: string, payload: Record<string, unknown>) {
  const title = asString(payload.title || payload.task || payload.event || payload.description);
  const contact = asString(payload.contactName || payload.name || payload.to);
  const date = asString(payload.remindAt || payload.dueAt || payload.startsAt || payload.scheduledAt || payload.date || payload.datetime);
  const text = asString(payload.text || payload.message || payload.body);

  return {
    action,
    title,
    description: asString(payload.description || payload.notes),
    contact,
    phone: phoneFromPayload(payload),
    date,
    priority: asString(payload.priority),
    status: asString(payload.status),
    location: asString(payload.location),
    participants: asString(payload.participants),
    recurrence: asString(payload.recurrence),
    text
  };
}

function normalizeDateKeyInput(value: unknown, timeZone: string) {
  const text = asString(value);
  if (!text) return '';
  const direct = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (direct) return direct[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : dateKeyFromDate(parsed, timeZone);
}

function searchDateRange(payload: Record<string, unknown>, timeZone: string, referenceDate: Date) {
  const todayKey = dateKeyFromDate(referenceDate, timeZone);
  const date = normalizeDateKeyInput(payload.date || payload.day || payload.onDate, timeZone);
  const startKey = normalizeDateKeyInput(payload.startDate || payload.fromDate || payload.from, timeZone) || date;
  const endKey = normalizeDateKeyInput(payload.endDate || payload.toDate || payload.to, timeZone) || date || startKey;

  if (!startKey && !endKey) {
    return {
      todayKey,
      startKey: '',
      endKey: '',
      start: null as Date | null,
      end: null as Date | null
    };
  }

  const normalizedStart = startKey || endKey;
  const normalizedEnd = endKey || startKey;
  return {
    todayKey,
    startKey: normalizedStart <= normalizedEnd ? normalizedStart : normalizedEnd,
    endKey: normalizedStart <= normalizedEnd ? normalizedEnd : normalizedStart,
    start: startOfDateKeyUtc(normalizedStart <= normalizedEnd ? normalizedStart : normalizedEnd),
    end: endOfDateKeyUtc(normalizedStart <= normalizedEnd ? normalizedEnd : normalizedStart)
  };
}

function searchTypes(payload: Record<string, unknown>, query: string) {
  const rawTypes = Array.isArray(payload.types) ? payload.types : [payload.type, payload.kind, payload.category];
  const normalized = normalizeSearchText([...rawTypes, query].filter(Boolean).join(' '));

  return {
    tasks: !normalized || /tarea|pendiente|todo/.test(normalized),
    reminders: !normalized || /recordatorio|alarma|aviso/.test(normalized),
    events: !normalized || /agenda|evento|reunion|cita/.test(normalized),
    contacts: !normalized || /contacto|agenda de contacto|telefono/.test(normalized),
    financial: payload.includeFinancial !== false && (!normalized || /finanza|vencimiento|pago|cuota|tarjeta|deuda|pendiente/.test(normalized))
  };
}

function meaningfulTextQuery(query: string) {
  const ignored = new Set([
    'agenda', 'agendas', 'asistente', 'aviso', 'avisos', 'con', 'consulta', 'consultar',
    'de', 'del', 'detalle', 'detallame', 'dia', 'el', 'en', 'evento', 'eventos',
    'financiero', 'financieros', 'hoy', 'la', 'las', 'los', 'manana', 'mi', 'mis',
    'pago', 'pagos', 'para', 'pendiente', 'pendientes', 'que', 'recordatorio',
    'recordatorios', 'resumen', 'tarea', 'tareas', 'tengo', 'vencimiento', 'vencimientos'
  ]);
  return searchableTokens(query)
    .filter((token) => !ignored.has(token))
    .join(' ');
}

function daysBetweenDateKeys(fromKey: string, toKey: string) {
  const ms = parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime();
  return Math.round(ms / 86400000);
}

export async function searchPersonalItems(userId: string, payload: Record<string, unknown>) {
  const limit = clampLimit(payload.limit, 10, 50);
  const rawQuery = asString(payload.query || payload.text || payload.search);
  const query = meaningfulTextQuery(rawQuery);
  const timeZone = asString(payload.timeZone) || PERSONAL_DEFAULT_TIMEZONE;
  const referenceDate = asDate(payload.referenceDate) || new Date();
  const range = searchDateRange(payload, timeZone, referenceDate);
  const types = searchTypes(payload, rawQuery);
  const dateFilter = range.start && range.end ? { gte: range.start, lte: range.end } : undefined;
  const includeCompleted = asBoolean(payload.includeCompleted)
    || asBoolean(payload.includeDone)
    || asBoolean(payload.includeHistory)
    || asBoolean(payload.includeRealizados)
    || /\b(completad[oa]s?|realizad[oa]s?|historial|hech[oa]s?)\b/.test(normalizeSearchText(rawQuery));

  const [tasks, reminders, events, contacts, alertPreference] = await Promise.all([
    types.tasks ? prisma.personalTask.findMany({
      where: {
        userId,
        status: includeCompleted ? { not: 'CANCELLED' } : { in: ['PENDING', 'IN_PROGRESS'] },
        ...(dateFilter ? { dueAt: dateFilter } : {}),
        ...(query ? { title: { contains: query, mode: 'insensitive' } } : {})
      },
      orderBy: [{ dueAt: 'asc' }, { updatedAt: 'desc' }],
      take: limit
    }) : Promise.resolve([]),
    types.reminders ? prisma.personalReminder.findMany({
      where: {
        userId,
        status: includeCompleted ? { not: 'CANCELLED' } : 'PENDING',
        ...(dateFilter ? { remindAt: dateFilter } : {}),
        ...(query ? { title: { contains: query, mode: 'insensitive' } } : {})
      },
      orderBy: { remindAt: 'asc' },
      take: limit
    }) : Promise.resolve([]),
    types.events ? prisma.personalEvent.findMany({
      where: {
        userId,
        status: includeCompleted ? { not: 'CANCELLED' } : 'SCHEDULED',
        ...(dateFilter ? { startsAt: dateFilter } : {}),
        ...(query ? { title: { contains: query, mode: 'insensitive' } } : {})
      },
      orderBy: { startsAt: 'asc' },
      take: limit
    }) : Promise.resolve([]),
    types.contacts && !dateFilter ? prisma.personalContact.findMany({
      where: {
        userId,
        ...(query ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { alias: { contains: query, mode: 'insensitive' } }
          ]
        } : {})
      },
      orderBy: { name: 'asc' },
      take: limit
    }) : Promise.resolve([]),
    prisma.alertPreference.findUnique({ where: { userId } })
  ]);

  let financialAlerts: Awaited<ReturnType<typeof getPendingAlertsForUser>>['items'] = [];
  if (types.financial) {
    const alertTimezone = normalizeAlertPreference(alertPreference).timezone;
    const todayKey = dateKeyFromDate(referenceDate, alertTimezone);
    const startDelta = range.startKey ? daysBetweenDateKeys(todayKey, range.startKey) : -365;
    const endDelta = range.endKey ? daysBetweenDateKeys(todayKey, range.endKey) : Math.max(Number(payload.daysAhead || 45), 1);
    const pending = await getPendingAlertsForUser(userId, {
      referenceDate,
      timeZone: alertTimezone,
      daysBack: Math.max(365, Math.abs(Math.min(startDelta, 0))),
      daysAhead: Math.max(1, endDelta)
    });

    financialAlerts = pending.items
      .filter((item) => !range.startKey || (item.dueDate >= range.startKey && item.dueDate <= range.endKey))
      .filter((item) => {
        if (!query) return true;
        const haystack = normalizeSearchText([
          item.title,
          item.description,
          item.sourceLabel,
          item.categoryName
        ].join(' '));
        return haystack.includes(normalizeSearchText(query));
      })
      .slice(0, limit);
  }

  return {
    query: rawQuery,
    textQuery: query,
    range: {
      todayKey: range.todayKey,
      startKey: range.startKey,
      endKey: range.endKey
    },
    tasks,
    reminders,
    events,
    contacts,
    financialAlerts
  };
}
