'use client';

import { useEffect, useMemo, useState } from 'react';

interface AlertPreference {
  enabled: boolean;
  phone: string;
  daysBefore: number;
  alertWindowDays: number;
  notifyHour: number;
  timezone: string;
}

interface PendingAlertItem {
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

interface PendingAlertsResponse {
  success: boolean;
  items: PendingAlertItem[];
  summary: {
    overdueCount: number;
    dueTodayCount: number;
    dueTomorrowCount: number;
    upcomingCount: number;
    totalAmount: number;
  };
  preference: AlertPreference;
}

const sectionOrder = [
  { key: 'overdue', title: 'Vencidos', empty: 'No hay vencidos.' },
  { key: 'today', title: 'Vencen hoy', empty: 'No hay pagos para hoy.' },
  { key: 'tomorrow', title: 'Vencen mañana', empty: 'No hay pagos para mañana.' },
  { key: 'upcoming', title: 'Próximos', empty: 'No hay próximos vencimientos.' }
] as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value);
}

function formatDueDate(dateKey: string) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function dueText(daysUntilDue: number) {
  if (daysUntilDue < 0) return `Venció hace ${Math.abs(daysUntilDue)} día(s)`;
  if (daysUntilDue === 0) return 'Vence hoy';
  if (daysUntilDue === 1) return 'Vence mañana';
  return `Vence en ${daysUntilDue} día(s)`;
}

export default function AlertsPanel() {
  const [items, setItems] = useState<PendingAlertItem[]>([]);
  const [summary, setSummary] = useState<PendingAlertsResponse['summary'] | null>(null);
  const [preference, setPreference] = useState<AlertPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<'dry' | 'send' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const grouped = useMemo(() => ({
    overdue: items.filter((item) => item.daysUntilDue < 0),
    today: items.filter((item) => item.daysUntilDue === 0),
    tomorrow: items.filter((item) => item.daysUntilDue === 1),
    upcoming: items.filter((item) => item.daysUntilDue > 1)
  }), [items]);

  async function fetchPending() {
    setLoading(true);
    try {
      const response = await fetch('/api/alerts/pending');
      const data: PendingAlertsResponse = await response.json();
      if (!response.ok || !data.success) {
        throw new Error('No se pudieron cargar las alertas');
      }

      setItems(data.items || []);
      setSummary(data.summary);
      setPreference(data.preference);
    } catch (error) {
      console.error(error);
      setMessage('No se pudieron cargar las alertas.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPending();
  }, []);

  async function savePreference(nextPreference: AlertPreference) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/alerts/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextPreference)
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'No se pudo guardar la configuración');
      }

      setPreference(data.preference);
      setMessage('Configuración guardada.');
    } catch (error) {
      console.error(error);
      setMessage('No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  }

  async function updateItemStatus(item: PendingAlertItem, status: 'PAID' | 'CANCELLED') {
    setBusyId(item.id);
    setMessage(null);
    try {
      if (item.sourceType === 'PROJECTION') {
        const refs = item.projectionRefs?.length
          ? item.projectionRefs
          : [{ referenceId: item.referenceId || item.sourceId, date: `${item.dueDate}T00:00:00.000Z` }];

        const responses = await Promise.all(refs.map((ref) => fetch('/api/projections/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ referenceId: ref.referenceId, date: ref.date, status })
        })));

        if (responses.some((response) => !response.ok)) {
          throw new Error('No se pudo actualizar el estado');
        }
      } else {
        const response = await fetch('/api/transactions/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.sourceId, status })
        });

        if (!response.ok) {
          throw new Error('No se pudo actualizar el estado');
        }
      }

      await fetchPending();
      setMessage(status === 'PAID' ? 'Marcado como pagado.' : 'Marcado como cancelado.');
    } catch (error) {
      console.error(error);
      setMessage('No se pudo actualizar el estado del pendiente.');
    } finally {
      setBusyId(null);
    }
  }

  async function dismissItemAlert(item: PendingAlertItem) {
    setBusyId(item.id);
    setMessage(null);
    try {
      const response = await fetch('/api/alerts/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertKey: item.alertKey,
          sourceType: item.sourceType,
          sourceId: item.sourceId,
          title: item.title,
          dueDate: item.dueDate
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'No se pudo ocultar la alerta');
      }

      await fetchPending();
      setMessage('Alerta cancelada. No se mostrara ni se reclamara por WhatsApp.');
    } catch (error) {
      console.error(error);
      setMessage('No se pudo cancelar la alerta.');
    } finally {
      setBusyId(null);
    }
  }

  async function runManualAlertTest(dryRun: boolean) {
    setTesting(dryRun ? 'dry' : 'send');
    setMessage(null);
    try {
      const params = new URLSearchParams({
        manualTest: 'true',
        dryRun: dryRun ? 'true' : 'false'
      });
      const response = await fetch(`/api/alerts/dispatch?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'No se pudo ejecutar la prueba');
      }

      const result = data.results?.[0];
      if (!result) {
        setMessage('Prueba ejecutada, sin resultados para mostrar.');
        return;
      }

      if (result.reason === 'no_items') {
        setMessage(`Prueba ejecutada: no hay vencimientos para ${result.dueDate}.`);
        return;
      }

      if (result.reason === 'already_sent') {
        setMessage('Prueba ejecutada: esos vencimientos ya fueron avisados hoy.');
        return;
      }

      if (result.reason === 'send_failed') {
        setMessage(`No se pudo enviar WhatsApp: ${result.error || 'error desconocido'}`);
        return;
      }

      if (dryRun) {
        setMessage(`Simulacion OK: se avisarian ${result.itemCount} pendiente(s) por ${formatMoney(result.totalAmount)}.`);
        return;
      }

      if (result.sent) {
        setMessage(`WhatsApp enviado: ${result.itemCount} pendiente(s) por ${formatMoney(result.totalAmount)}.`);
        return;
      }

      setMessage(`Prueba ejecutada: ${result.reason || 'sin envio'}.`);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'No se pudo ejecutar la prueba manual.');
    } finally {
      setTesting(null);
    }
  }

  if (loading && !preference) {
    return <div className="text-sm text-gray-500 dark:text-slate-400">Cargando alertas...</div>;
  }

  if (!preference || !summary) {
    return <div className="text-sm text-rose-600 dark:text-rose-300">No se pudo cargar la bandeja de alertas.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-rose-200 dark:border-rose-900/40 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Vencidos</p>
          <p className="mt-2 text-2xl font-bold text-rose-600 dark:text-rose-300">{summary.overdueCount}</p>
        </div>
        <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Hoy</p>
          <p className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-300">{summary.dueTodayCount}</p>
        </div>
        <div className="rounded-2xl border border-blue-200 dark:border-blue-900/40 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Mañana</p>
          <p className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-300">{summary.dueTomorrowCount}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Total pendiente</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-300">{formatMoney(summary.totalAmount)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">Configuración de avisos</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              La app toma los gastos pendientes y vencimientos de tarjeta desde la planilla principal y te avisa 1 día antes.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={preference.enabled}
              onChange={(event) => setPreference({ ...preference, enabled: event.target.checked })}
              className="h-4 w-4 rounded border-gray-300"
            />
            Activar WhatsApp
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">WhatsApp</span>
            <input
              type="text"
              value={preference.phone}
              onChange={(event) => setPreference({ ...preference, phone: event.target.value })}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 px-3 py-2 text-sm text-gray-800 dark:text-slate-100"
              placeholder="549..."
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Anticipación</span>
            <input
              type="number"
              min={0}
              max={30}
              value={preference.daysBefore}
              onChange={(event) => setPreference({ ...preference, daysBefore: Number(event.target.value) || 0 })}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 px-3 py-2 text-sm text-gray-800 dark:text-slate-100"
            />
            <span className="mt-1 block text-[11px] text-gray-500 dark:text-slate-400">Dias antes para WhatsApp.</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Mostrar hasta</span>
            <input
              type="number"
              min={1}
              max={365}
              value={preference.alertWindowDays}
              onChange={(event) => setPreference({ ...preference, alertWindowDays: Number(event.target.value) || 1 })}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 px-3 py-2 text-sm text-gray-800 dark:text-slate-100"
            />
            <span className="mt-1 block text-[11px] text-gray-500 dark:text-slate-400">Dias hacia adelante en Alertas.</span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Hora</span>
            <input
              type="number"
              min={0}
              max={23}
              value={preference.notifyHour}
              onChange={(event) => setPreference({ ...preference, notifyHour: Number(event.target.value) || 0 })}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-950 px-3 py-2 text-sm text-gray-800 dark:text-slate-100"
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Zona horaria fija: {preference.timezone}. Si un gasto está en estado <span className="font-semibold">Pendiente</span>, la fecha se usa como vencimiento.
          </p>
          <button
            onClick={() => runManualAlertTest(true)}
            disabled={testing !== null}
            className="rounded-xl border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-blue-700 dark:text-blue-300"
          >
            {testing === 'dry' ? 'Probando...' : 'Simular prueba'}
          </button>
          <button
            onClick={() => runManualAlertTest(false)}
            disabled={testing !== null}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white"
          >
            {testing === 'send' ? 'Enviando...' : 'Enviar prueba WhatsApp'}
          </button>
          <button
            onClick={() => savePreference(preference)}
            disabled={saving}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 px-4 py-2 text-sm font-semibold text-white"
          >
            {saving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>

        {message && (
          <div className="rounded-xl bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">
            {message}
          </div>
        )}
      </div>

      <div className="space-y-4">
        {sectionOrder.map((section) => {
          const sectionItems = grouped[section.key];
          return (
            <section key={section.key} className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100">{section.title}</h3>
                <span className="rounded-full bg-gray-100 dark:bg-slate-800 px-3 py-1 text-xs font-semibold text-gray-600 dark:text-slate-300">
                  {sectionItems.length} item(s)
                </span>
              </div>

              {sectionItems.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400">{section.empty}</p>
              ) : (
                <div className="space-y-3">
                  {sectionItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 p-4"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold text-gray-800 dark:text-slate-100">{item.title}</h4>
                            <span className="rounded-full bg-white dark:bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-300">
                              {item.sourceType === 'PROJECTION' ? 'Tarjeta' : 'Planilla'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 dark:text-slate-300">{item.description}</p>
                          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-slate-400">
                            <span>{item.sourceLabel}</span>
                            <span>{item.categoryName}</span>
                            <span>{formatDueDate(item.dueDate)}</span>
                            <span>{dueText(item.daysUntilDue)}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-start lg:items-end gap-3">
                          <span className="text-xl font-bold text-gray-900 dark:text-slate-100">{formatMoney(item.amount)}</span>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => updateItemStatus(item, 'PAID')}
                              disabled={busyId === item.id}
                              className="rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 px-3 py-2 text-sm font-semibold text-white"
                            >
                              {busyId === item.id ? 'Actualizando...' : 'Marcar pagado'}
                            </button>
                            <button
                              onClick={() => dismissItemAlert(item)}
                              disabled={busyId === item.id}
                              className="rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 px-3 py-2 text-sm font-semibold text-white"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
