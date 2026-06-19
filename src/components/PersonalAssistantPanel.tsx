'use client';

import { CalendarPlus, Check, Clock, Pencil, Save, X } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

interface Contact {
  id: string;
  name: string;
  phone: string;
  alias?: string | null;
  relation?: string | null;
  notes?: string | null;
}

interface Reminder {
  id: string;
  title: string;
  description?: string | null;
  remindAt: string;
  priority: string;
  status: string;
  channel: string;
  recurrence?: string | null;
}

interface Task {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  priority: string;
  status: string;
  tags?: string | null;
}

interface EventItem {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: string;
  endsAt?: string | null;
  participants?: string | null;
  status: string;
}

interface OutboundMessage {
  id: string;
  phone: string;
  contactName?: string | null;
  text: string;
  scheduledAt?: string | null;
  sentAt?: string | null;
  status: string;
  error?: string | null;
}

interface ActionLog {
  id: string;
  source: string;
  action: string;
  status: string;
  summary?: string | null;
  createdAt: string;
}

interface FinancialAlert {
  id: string;
  title: string;
  amount: number;
  dueDate: string;
  daysUntilDue: number;
  sourceLabel: string;
}

interface Overview {
  success: boolean;
  todayKey: string;
  summary: {
    contactsCount: number;
    remindersToday: number;
    tasksPending: number;
    tasksOverdue: number;
    eventsToday: number;
    messagesPending: number;
    financialDueToday: number;
    financialOverdue: number;
    financialAmountToday: number;
  };
  contacts: Contact[];
  reminders: Reminder[];
  tasks: Task[];
  events: EventItem[];
  outboundMessages: OutboundMessage[];
  actionLogs: ActionLog[];
  financialAlerts: {
    items: FinancialAlert[];
  };
}

type EditingType = 'task' | 'reminder' | 'event';

interface EditingItem {
  type: EditingType;
  id: string;
  values: {
    title: string;
    dateTime: string;
    endDateTime: string;
    priority: string;
    description: string;
    tags: string;
    recurrence: string;
    location: string;
    participants: string;
  };
}

const emptyOverview: Overview = {
  success: true,
  todayKey: '',
  summary: {
    contactsCount: 0,
    remindersToday: 0,
    tasksPending: 0,
    tasksOverdue: 0,
    eventsToday: 0,
    messagesPending: 0,
    financialDueToday: 0,
    financialOverdue: 0,
    financialAmountToday: 0
  },
  contacts: [],
  reminders: [],
  tasks: [],
  events: [],
  outboundMessages: [],
  actionLogs: [],
  financialAlerts: {
    items: []
  }
};

function dateTimeInputValue(value?: string | Date | null) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function dateTimeLocalNow(offsetHours = 1) {
  const date = new Date();
  date.setHours(date.getHours() + offsetHours);
  date.setMinutes(0, 0, 0);
  return dateTimeInputValue(date);
}

function priorityClass(priority: string) {
  if (priority === 'HIGH') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300';
  if (priority === 'LOW') return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: 'Pendiente',
    IN_PROGRESS: 'En curso',
    DONE: 'Hecho',
    CANCELLED: 'Cancelado',
    SCHEDULED: 'Programado',
    DRAFT: 'Preparado',
    SENT: 'Enviado',
    FAILED: 'Fallido'
  };
  return labels[status] || status;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value);
}

function upcomingDetail(prefix: string, title?: string, date?: string | null) {
  if (!title) return `Sin ${prefix.toLowerCase()} proximos`;
  return `Proximo: ${title}${date ? ` (${formatDateTime(date)})` : ''}`;
}

function isoFromLocal(value: string) {
  return value ? new Date(value).toISOString() : null;
}

const inputClass = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100';
const smallPrimaryButtonClass = 'inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60';
const smallSecondaryButtonClass = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-60';

export default function PersonalAssistantPanel() {
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [testingAutomation, setTestingAutomation] = useState(false);
  const [importingContacts, setImportingContacts] = useState(false);

  const [contactForm, setContactForm] = useState({ name: '', phone: '', alias: '', relation: '', notes: '' });
  const [reminderForm, setReminderForm] = useState({
    title: '',
    remindAt: dateTimeLocalNow(),
    priority: 'MEDIUM',
    description: '',
    recurrence: ''
  });
  const [taskForm, setTaskForm] = useState({
    title: '',
    dueAt: '',
    priority: 'MEDIUM',
    description: '',
    tags: ''
  });
  const [eventForm, setEventForm] = useState({
    title: '',
    startsAt: dateTimeLocalNow(2),
    endsAt: '',
    location: '',
    participants: '',
    description: ''
  });
  const [messageForm, setMessageForm] = useState({
    contactId: '',
    phone: '',
    contactName: '',
    text: '',
    scheduledAt: ''
  });

  const upcomingReminders = useMemo(
    () => overview.reminders.filter((item) => item.status === 'PENDING').slice(0, 8),
    [overview.reminders]
  );
  const pendingTasks = useMemo(
    () => overview.tasks.filter((item) => item.status !== 'DONE' && item.status !== 'CANCELLED').slice(0, 10),
    [overview.tasks]
  );
  const upcomingEvents = useMemo(
    () => overview.events.filter((item) => item.status === 'SCHEDULED').slice(0, 8),
    [overview.events]
  );
  const todayFinancialAlerts = useMemo(
    () => overview.financialAlerts.items.filter((item) => item.daysUntilDue <= 0).slice(0, 6),
    [overview.financialAlerts.items]
  );

  async function fetchOverview() {
    setLoading(true);
    try {
      const response = await fetch('/api/personal-assistant');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo cargar el asistente');
      setOverview(data);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'No se pudo cargar el asistente.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOverview();
  }, []);

  async function runAction(action: string, payload: Record<string, unknown>, successText: string) {
    setMessage(null);
    try {
      const response = await fetch('/api/personal-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, payload })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo guardar');
      await fetchOverview();
      setMessage(successText);
      return data;
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la accion.');
      return null;
    }
  }

  async function createContact(event: FormEvent) {
    event.preventDefault();
    const data = await runAction('create_contact', contactForm, 'Contacto guardado.');
    if (data) setContactForm({ name: '', phone: '', alias: '', relation: '', notes: '' });
  }

  async function importContactsCsv(file?: File | null) {
    if (!file) return;
    setMessage(null);
    setImportingContacts(true);
    try {
      const csvText = await file.text();
      const response = await fetch('/api/personal-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_google_contacts_csv',
          payload: { csvText }
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo importar el CSV');

      const result = data.result || {};
      await fetchOverview();
      setMessage(`Importacion lista: ${result.created || 0} nuevo(s), ${result.updated || 0} actualizado(s), ${result.skipped || 0} duplicado(s), ${result.invalid || 0} fila(s) sin telefono util.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'No se pudo importar el CSV.');
    } finally {
      setImportingContacts(false);
    }
  }

  async function createReminder(event: FormEvent) {
    event.preventDefault();
    const data = await runAction('create_reminder', {
      ...reminderForm,
      remindAt: isoFromLocal(reminderForm.remindAt)
    }, 'Recordatorio creado.');
    if (data) setReminderForm({ title: '', remindAt: dateTimeLocalNow(), priority: 'MEDIUM', description: '', recurrence: '' });
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    const data = await runAction('create_task', {
      ...taskForm,
      dueAt: isoFromLocal(taskForm.dueAt)
    }, 'Tarea creada.');
    if (data) setTaskForm({ title: '', dueAt: '', priority: 'MEDIUM', description: '', tags: '' });
  }

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    const data = await runAction('create_event', {
      ...eventForm,
      startsAt: isoFromLocal(eventForm.startsAt),
      endsAt: isoFromLocal(eventForm.endsAt)
    }, 'Evento agendado.');
    if (data) setEventForm({ title: '', startsAt: dateTimeLocalNow(2), endsAt: '', location: '', participants: '', description: '' });
  }

  async function submitMessageForm(event: FormEvent) {
    event.preventDefault();
    await createMessage(false);
  }

  async function createMessage(sendNow = false) {
    const contact = overview.contacts.find((item) => item.id === messageForm.contactId);
    const payload = {
      ...messageForm,
      contactName: contact?.name || messageForm.contactName,
      phone: contact?.phone || messageForm.phone,
      scheduledAt: isoFromLocal(messageForm.scheduledAt)
    };

    if (sendNow && !window.confirm('Confirmas enviar este WhatsApp ahora?')) return;

    const data = await runAction(sendNow ? 'send_message_now' : 'create_message', payload, sendNow ? 'WhatsApp enviado.' : 'Mensaje preparado.');
    if (data) setMessageForm({ contactId: '', phone: '', contactName: '', text: '', scheduledAt: '' });
  }

  async function updateTaskStatus(task: Task, status: string) {
    setBusyId(task.id);
    await runAction('update_task_status', { id: task.id, status }, 'Tarea actualizada.');
    setBusyId(null);
  }

  async function updateReminderStatus(reminder: Reminder, status: string) {
    setBusyId(reminder.id);
    await runAction('update_reminder_status', { id: reminder.id, status }, 'Recordatorio actualizado.');
    setBusyId(null);
  }

  async function postponeReminder(reminder: Reminder, payload: Record<string, unknown>, label: string) {
    setBusyId(reminder.id);
    await runAction('postpone_reminder', { id: reminder.id, ...payload }, `Recordatorio pospuesto: ${label}.`);
    setBusyId(null);
  }

  async function postponeTask(task: Task, payload: Record<string, unknown>, label: string) {
    setBusyId(task.id);
    await runAction('postpone_task', { id: task.id, ...payload }, `Tarea pospuesta: ${label}.`);
    setBusyId(null);
  }

  async function updateEventStatus(event: EventItem, status: string) {
    setBusyId(event.id);
    await runAction('update_event_status', { id: event.id, status }, 'Evento actualizado.');
    setBusyId(null);
  }

  async function postponeEvent(event: EventItem, payload: Record<string, unknown>, label: string) {
    setBusyId(event.id);
    await runAction('postpone_event', { id: event.id, ...payload }, `Evento pospuesto: ${label}.`);
    setBusyId(null);
  }

  function editValuesFromTask(task: Task): EditingItem {
    return {
      type: 'task',
      id: task.id,
      values: {
        title: task.title,
        dateTime: dateTimeInputValue(task.dueAt),
        endDateTime: '',
        priority: task.priority,
        description: task.description || '',
        tags: task.tags || '',
        recurrence: '',
        location: '',
        participants: ''
      }
    };
  }

  function editValuesFromReminder(reminder: Reminder): EditingItem {
    return {
      type: 'reminder',
      id: reminder.id,
      values: {
        title: reminder.title,
        dateTime: dateTimeInputValue(reminder.remindAt),
        endDateTime: '',
        priority: reminder.priority,
        description: reminder.description || '',
        tags: '',
        recurrence: reminder.recurrence || '',
        location: '',
        participants: ''
      }
    };
  }

  function editValuesFromEvent(event: EventItem): EditingItem {
    return {
      type: 'event',
      id: event.id,
      values: {
        title: event.title,
        dateTime: dateTimeInputValue(event.startsAt),
        endDateTime: dateTimeInputValue(event.endsAt),
        priority: 'MEDIUM',
        description: event.description || '',
        tags: '',
        recurrence: '',
        location: event.location || '',
        participants: event.participants || ''
      }
    };
  }

  function updateEditingValues(values: Partial<EditingItem['values']>) {
    setEditingItem((current) => current ? { ...current, values: { ...current.values, ...values } } : current);
  }

  async function saveEditingItem(event: FormEvent) {
    event.preventDefault();
    if (!editingItem) return;

    const { type, id, values } = editingItem;
    setBusyId(id);
    const commonPayload = {
      id,
      title: values.title,
      description: values.description
    };

    const data = type === 'task'
      ? await runAction('update_task', {
        ...commonPayload,
        dueAt: isoFromLocal(values.dateTime),
        priority: values.priority,
        tags: values.tags
      }, 'Tarea editada.')
      : type === 'reminder'
        ? await runAction('update_reminder', {
          ...commonPayload,
          remindAt: isoFromLocal(values.dateTime),
          priority: values.priority,
          recurrence: values.recurrence
        }, 'Recordatorio editado.')
        : await runAction('update_event', {
          ...commonPayload,
          startsAt: isoFromLocal(values.dateTime),
          endsAt: isoFromLocal(values.endDateTime),
          location: values.location,
          participants: values.participants
        }, 'Evento editado.');

    if (data) setEditingItem(null);
    setBusyId(null);
  }

  function renderEditForm(type: EditingType, id: string) {
    if (!editingItem || editingItem.type !== type || editingItem.id !== id) return null;
    const values = editingItem.values;
    const dateLabel = type === 'event' ? 'Inicio' : type === 'reminder' ? 'Recordar' : 'Vence';

    return (
      <form onSubmit={saveEditingItem} className="mt-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/80 p-3">
        <input required value={values.title} onChange={(e) => updateEditingValues({ title: e.target.value })} placeholder="Titulo" className={inputClass} />
        <input
          required={type !== 'task'}
          type="datetime-local"
          aria-label={dateLabel}
          value={values.dateTime}
          onChange={(e) => updateEditingValues({ dateTime: e.target.value })}
          className={inputClass}
        />
        {type === 'event' && (
          <>
            <input type="datetime-local" aria-label="Fin" value={values.endDateTime} onChange={(e) => updateEditingValues({ endDateTime: e.target.value })} className={inputClass} />
            <input value={values.location} onChange={(e) => updateEditingValues({ location: e.target.value })} placeholder="Lugar" className={inputClass} />
            <input value={values.participants} onChange={(e) => updateEditingValues({ participants: e.target.value })} placeholder="Participantes" className={inputClass} />
          </>
        )}
        {(type === 'task' || type === 'reminder') && (
          <select value={values.priority} onChange={(e) => updateEditingValues({ priority: e.target.value })} className={inputClass}>
            <option value="LOW">Baja</option>
            <option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option>
          </select>
        )}
        {type === 'task' && <input value={values.tags} onChange={(e) => updateEditingValues({ tags: e.target.value })} placeholder="Etiquetas" className={inputClass} />}
        {type === 'reminder' && <input value={values.recurrence} onChange={(e) => updateEditingValues({ recurrence: e.target.value })} placeholder="Repeticion opcional" className={inputClass} />}
        <textarea value={values.description} onChange={(e) => updateEditingValues({ description: e.target.value })} placeholder="Notas" className={`${inputClass} min-h-20`} />
        <div className="flex flex-wrap gap-2">
          <button disabled={busyId === editingItem.id} className={smallPrimaryButtonClass}>
            <Save size={14} aria-hidden="true" />
            Guardar
          </button>
          <button type="button" onClick={() => setEditingItem(null)} className={smallSecondaryButtonClass}>
            <X size={14} aria-hidden="true" />
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  async function runAutomationDryTest() {
    setTestingAutomation(true);
    setMessage(null);
    try {
      const response = await fetch('/api/personal-assistant/dispatch?manualTest=true&dryRun=true');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo probar la automatizacion');
      const result = data.results?.[0];
      setMessage(result
        ? `Automatizacion OK: ${result.reminders} recordatorio(s), ${result.events || 0} evento(s), ${result.messages} mensaje(s), resumen diario: ${result.dailySummary ? 'si' : 'no'}.`
        : 'Automatizacion OK, sin acciones pendientes.');
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'No se pudo probar la automatizacion.');
    } finally {
      setTestingAutomation(false);
    }
  }

  if (loading && !overview.todayKey) {
    return <div className="text-sm text-slate-500 dark:text-slate-400">Cargando asistente personal...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-7 gap-4">
        {[
          ['Contactos', overview.summary.contactsCount],
          ['Recordatorios hoy', overview.summary.remindersToday],
          ['Tareas pendientes', overview.summary.tasksPending],
          ['Tareas vencidas', overview.summary.tasksOverdue],
          ['Eventos hoy', overview.summary.eventsToday],
          ['Mensajes pendientes', overview.summary.messagesPending],
          ['Finanzas hoy', overview.summary.financialDueToday]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
          </div>
        ))}
      </div>

      {message && (
        <div className="rounded-2xl border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-sm text-blue-800 dark:text-blue-200">
          {message}
        </div>
      )}

      <section className="rounded-3xl border border-emerald-200 dark:border-emerald-900/50 bg-gradient-to-br from-emerald-50 via-white to-sky-50 dark:from-emerald-950/25 dark:via-slate-900 dark:to-sky-950/20 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">Hoy, en una sola mirada</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Agenda, tareas, recordatorios y vencimientos financieros combinados.
            </p>
          </div>
          <button
            onClick={runAutomationDryTest}
            disabled={testingAutomation}
            className="rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white/80 dark:bg-slate-900/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 px-4 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
          >
            {testingAutomation ? 'Probando...' : 'Probar automatizacion'}
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-4 gap-4">
          <TodayCard title="Agenda" value={`${overview.summary.eventsToday} hoy`} detail={upcomingDetail('eventos', upcomingEvents[0]?.title, upcomingEvents[0]?.startsAt)} />
          <TodayCard title="Recordatorios" value={`${overview.summary.remindersToday} hoy`} detail={upcomingDetail('recordatorios', upcomingReminders[0]?.title, upcomingReminders[0]?.remindAt)} />
          <TodayCard title="Tareas" value={`${overview.summary.tasksPending} pendientes`} detail={overview.summary.tasksOverdue ? `${overview.summary.tasksOverdue} vencida(s)` : (pendingTasks[0] ? `Proxima: ${pendingTasks[0].title}${pendingTasks[0].dueAt ? ` (${formatDateTime(pendingTasks[0].dueAt)})` : ''}` : 'Sin tareas pendientes')} />
          <TodayCard title="Finanzas" value={formatMoney(overview.summary.financialAmountToday)} detail={overview.summary.financialOverdue ? `${overview.summary.financialOverdue} vencimiento(s) atrasado(s)` : `${overview.summary.financialDueToday} vencen hoy`} />
        </div>

        {todayFinancialAlerts.length > 0 && (
          <div className="mt-5 rounded-2xl bg-white/75 dark:bg-slate-950/60 p-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Vencimientos financieros urgentes</h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              {todayFinancialAlerts.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.sourceLabel}</p>
                    </div>
                    <span className="text-sm font-bold text-rose-600 dark:text-rose-300">{formatMoney(item.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Accesos rapidos del asistente</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ['Tareas', '#tareas'],
            ['Recordatorios', '#recordatorios'],
            ['Agenda', '#agenda'],
            ['Contactos', '#contactos'],
            ['WhatsApp', '#whatsapp']
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              className="rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <ListSection id="tareas" title="Tareas pendientes" empty="No hay tareas pendientes. Crea una desde el formulario de abajo o pediselo al chat.">
          {pendingTasks.map((task) => (
            <div key={task.id} className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{task.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(task.dueAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityClass(task.priority)}`}>{task.priority}</span>
              </div>
              {editingItem?.type === 'task' && editingItem.id === task.id ? renderEditForm('task', task.id) : (
                <>
                  {task.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{task.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button disabled={busyId === task.id} onClick={() => updateTaskStatus(task, 'DONE')} className={smallPrimaryButtonClass}>
                      <Check size={14} aria-hidden="true" />
                      Marcar listo
                    </button>
                    <button disabled={busyId === task.id} onClick={() => postponeTask(task, { minutes: 30 }, '30 minutos')} className={smallSecondaryButtonClass}>
                      <Clock size={14} aria-hidden="true" />
                      +30 min
                    </button>
                    <button disabled={busyId === task.id} onClick={() => postponeTask(task, { days: 1 }, 'mañana')} className={smallSecondaryButtonClass}>
                      <CalendarPlus size={14} aria-hidden="true" />
                      Mañana
                    </button>
                    <button disabled={busyId === task.id} onClick={() => setEditingItem(editValuesFromTask(task))} className={smallSecondaryButtonClass}>
                      <Pencil size={14} aria-hidden="true" />
                      Editar
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </ListSection>

        <ListSection id="recordatorios" title="Recordatorios" empty="No hay recordatorios activos. Crea uno desde el formulario de abajo o pediselo al chat.">
          {upcomingReminders.map((reminder) => (
            <div key={reminder.id} className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{reminder.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(reminder.remindAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${priorityClass(reminder.priority)}`}>{reminder.priority}</span>
              </div>
              {editingItem?.type === 'reminder' && editingItem.id === reminder.id ? renderEditForm('reminder', reminder.id) : (
                <>
                  {reminder.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{reminder.description}</p>}
                  <button disabled={busyId === reminder.id} onClick={() => updateReminderStatus(reminder, 'DONE')} className="mt-3 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Marcar listo</button>
                  <div className="mt-2 flex flex-wrap gap-2">
                <button disabled={busyId === reminder.id} onClick={() => postponeReminder(reminder, { minutes: 30 }, '30 minutos')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">+30 min</button>
                <button disabled={busyId === reminder.id} onClick={() => postponeReminder(reminder, { days: 1 }, 'mañana')} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">Mañana</button>
                    <button disabled={busyId === reminder.id} onClick={() => setEditingItem(editValuesFromReminder(reminder))} className={smallSecondaryButtonClass}>
                      <Pencil size={14} aria-hidden="true" />
                      Editar
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </ListSection>

        <ListSection id="agenda" title="Agenda" empty="No hay eventos proximos. Agenda uno desde el formulario de abajo.">
          {upcomingEvents.map((event) => (
            <div key={event.id} className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{event.title}</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(event.startsAt)}</p>
              {event.location && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Lugar: {event.location}</p>}
              {event.participants && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Con: {event.participants}</p>}
              {editingItem?.type === 'event' && editingItem.id === event.id ? renderEditForm('event', event.id) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busyId === event.id} onClick={() => updateEventStatus(event, 'DONE')} className={smallPrimaryButtonClass}>
                    <Check size={14} aria-hidden="true" />
                    Marcar listo
                  </button>
                  <button disabled={busyId === event.id} onClick={() => postponeEvent(event, { minutes: 30 }, '30 minutos')} className={smallSecondaryButtonClass}>
                    <Clock size={14} aria-hidden="true" />
                    +30 min
                  </button>
                  <button disabled={busyId === event.id} onClick={() => postponeEvent(event, { days: 1 }, 'mañana')} className={smallSecondaryButtonClass}>
                    <CalendarPlus size={14} aria-hidden="true" />
                    Mañana
                  </button>
                  <button disabled={busyId === event.id} onClick={() => setEditingItem(editValuesFromEvent(event))} className={smallSecondaryButtonClass}>
                    <Pencil size={14} aria-hidden="true" />
                    Editar
                  </button>
                </div>
              )}
            </div>
          ))}
        </ListSection>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Crear recordatorio</h2>
          <form onSubmit={createReminder} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required value={reminderForm.title} onChange={(e) => setReminderForm({ ...reminderForm, title: e.target.value })} placeholder="Titulo" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input required type="datetime-local" value={reminderForm.remindAt} onChange={(e) => setReminderForm({ ...reminderForm, remindAt: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <select value={reminderForm.priority} onChange={(e) => setReminderForm({ ...reminderForm, priority: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
            </select>
            <input value={reminderForm.recurrence} onChange={(e) => setReminderForm({ ...reminderForm, recurrence: e.target.value })} placeholder="Repeticion opcional" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <textarea value={reminderForm.description} onChange={(e) => setReminderForm({ ...reminderForm, description: e.target.value })} placeholder="Notas" className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <button className="md:col-span-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Guardar recordatorio</button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Crear tarea</h2>
          <form onSubmit={createTask} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} placeholder="Tarea" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input type="datetime-local" value={taskForm.dueAt} onChange={(e) => setTaskForm({ ...taskForm, dueAt: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
            </select>
            <input value={taskForm.tags} onChange={(e) => setTaskForm({ ...taskForm, tags: e.target.value })} placeholder="Etiquetas" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <textarea value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} placeholder="Notas" className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <button className="md:col-span-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Guardar tarea</button>
          </form>
        </section>

        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Agendar evento</h2>
          <form onSubmit={createEvent} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required value={eventForm.title} onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })} placeholder="Evento o reunion" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input required type="datetime-local" value={eventForm.startsAt} onChange={(e) => setEventForm({ ...eventForm, startsAt: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input type="datetime-local" value={eventForm.endsAt} onChange={(e) => setEventForm({ ...eventForm, endsAt: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input value={eventForm.location} onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })} placeholder="Lugar" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input value={eventForm.participants} onChange={(e) => setEventForm({ ...eventForm, participants: e.target.value })} placeholder="Participantes" className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <textarea value={eventForm.description} onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })} placeholder="Notas" className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <button className="md:col-span-2 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2 text-sm font-semibold text-white">Agendar evento</button>
          </form>
        </section>

        <section id="contactos" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 scroll-mt-24">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Contactos y WhatsApp</h2>
          <div className="mt-4 rounded-2xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/20 p-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Importar desde Google Contacts</p>
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                  Exporta tus contactos como CSV desde Google Contacts y cargalos aca. Se evitan duplicados por telefono.
                </p>
              </div>
              <label className={`inline-flex cursor-pointer items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white ${importingContacts ? 'bg-slate-400' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {importingContacts ? 'Importando...' : 'Elegir CSV'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={importingContacts}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    void importContactsCsv(file);
                  }}
                />
              </label>
            </div>
          </div>

          <form onSubmit={createContact} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <input required value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="Nombre" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input required value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="Telefono 549..." className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input value={contactForm.alias} onChange={(e) => setContactForm({ ...contactForm, alias: e.target.value })} placeholder="Alias" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input value={contactForm.relation} onChange={(e) => setContactForm({ ...contactForm, relation: e.target.value })} placeholder="Relacion" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <button className="md:col-span-2 rounded-xl bg-slate-800 hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 px-4 py-2 text-sm font-semibold text-white">Guardar contacto</button>
          </form>

          <form id="whatsapp" onSubmit={submitMessageForm} className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-200 dark:border-slate-800 pt-5 scroll-mt-24">
            <select value={messageForm.contactId} onChange={(e) => setMessageForm({ ...messageForm, contactId: e.target.value })} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="">Elegir contacto o cargar telefono</option>
              {overview.contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>{contact.name} - {contact.phone}</option>
              ))}
            </select>
            <input value={messageForm.phone} onChange={(e) => setMessageForm({ ...messageForm, phone: e.target.value })} placeholder="Telefono si no hay contacto" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <input type="datetime-local" value={messageForm.scheduledAt} onChange={(e) => setMessageForm({ ...messageForm, scheduledAt: e.target.value })} className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <textarea required value={messageForm.text} onChange={(e) => setMessageForm({ ...messageForm, text: e.target.value })} placeholder="Texto del WhatsApp" className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm" />
            <button className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold text-white">Preparar mensaje</button>
            <button type="button" onClick={() => createMessage(true)} className="rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Enviar ahora</button>
          </form>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ListSection title="Mensajes WhatsApp" empty="No hay mensajes preparados.">
          {overview.outboundMessages.slice(0, 8).map((item) => (
            <div key={item.id} className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.contactName || item.phone}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.scheduledAt ? formatDateTime(item.scheduledAt) : formatDateTime(item.sentAt)}</p>
                </div>
                <span className="rounded-full bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">{statusLabel(item.status)}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.text}</p>
              {item.error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{item.error}</p>}
            </div>
          ))}
        </ListSection>

        <ListSection title="Bitacora del asistente" empty="Todavia no hay acciones registradas.">
          {overview.actionLogs.map((log) => (
            <div key={log.id} className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{log.summary || log.action}</h3>
                <span className="rounded-full bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">{log.status}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{log.source} - {formatDateTime(log.createdAt)}</p>
            </div>
          ))}
        </ListSection>
      </div>
    </div>
  );
}

function ListSection({ id, title, empty, children }: { id?: string; title: string; empty: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(items) ? items.length === 0 : !items;

  return (
    <section id={id} className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 scroll-mt-24">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      <div className="mt-4 space-y-3">
        {isEmpty ? <p className="text-sm text-slate-500 dark:text-slate-400">{empty}</p> : items}
      </div>
    </section>
  );
}

function TodayCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/70 dark:border-slate-800 bg-white/80 dark:bg-slate-900/75 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
      <p className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{detail}</p>
    </div>
  );
}
