'use client';

import Link from 'next/link';
import PersonalAssistantPanel from '@/components/PersonalAssistantPanel';

export default function AsistentePage() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-4 flex items-center justify-between shadow-sm sticky top-0 z-30">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Asistente Personal</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Recordatorios, agenda, tareas, contactos y acciones por WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/alertas"
            className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-sm"
          >
            Alertas
          </Link>
          <Link
            href="/flow"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-sm"
          >
            Volver al flujo
          </Link>
        </div>
      </header>

      <main className="flex-1 p-4">
        <PersonalAssistantPanel />
      </main>
    </div>
  );
}
