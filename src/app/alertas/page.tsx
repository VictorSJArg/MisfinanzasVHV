'use client';

import Link from 'next/link';
import AlertsPanel from '@/components/AlertsPanel';

export default function AlertasPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex flex-col">
      <header className="bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 px-4 py-4 flex items-center justify-between shadow-sm sticky top-0 z-30">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-800 dark:text-slate-100">Alertas y Vencimientos</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Todo lo pendiente de pagar, tomado desde la planilla y las tarjetas.</p>
        </div>
        <Link
          href="/flow"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-sm"
        >
          Volver al flujo
        </Link>
      </header>

      <main className="flex-1 p-4">
        <AlertsPanel />
      </main>
    </div>
  );
}
