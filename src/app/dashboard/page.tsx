'use client';

import Dashboard from '@/components/Dashboard';
import Link from 'next/link';

export default function DashboardPage() {
    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between shadow-sm sticky top-0 z-30">
                <h1 className="text-xl font-bold tracking-tight text-gray-800">Dashboard</h1>
                <div className="flex items-center gap-2">
                    <Link
                        href="/alertas"
                        className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-sm"
                    >
                        Ver Alertas
                    </Link>
                    <Link
                        href="/asistente"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-sm"
                    >
                        Asistente
                    </Link>
                    <Link
                        href="/flow"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium text-sm transition-all shadow-sm"
                    >
                        Volver al Flujo
                    </Link>
                </div>
            </header>

            <main className="flex-1 p-4">
                <Dashboard />
            </main>
        </div>
    );
}
