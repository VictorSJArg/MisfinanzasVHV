'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import FlowGrid from '@/components/FlowGrid';
import TransactionForm from '@/components/TransactionForm';
import ExportButton from '@/components/ExportButton';

export default function FlowPage() {
    const [modalType, setModalType] = useState<'INCOME' | 'EXPENSE' | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    return (
        <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
            <header className="bg-white border-b border-gray-200 px-4 py-4 flex items-center justify-between shadow-sm flex-shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold tracking-tight text-gray-800">💰 Mis Finanzas VHV</h1>
                    <Link
                        href="/dashboard"
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium hover:underline"
                    >
                        📊 Dashboard
                    </Link>
                    <Link
                        href="/tarjetas"
                        className="text-sm text-purple-600 hover:text-purple-700 font-medium hover:underline"
                    >
                        💳 Tarjetas
                    </Link>
                </div>
                <div className="flex gap-2">
                    <ExportButton />
                    <button
                        onClick={() => setModalType('INCOME')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-all shadow-sm active:scale-95"
                    >
                        + Ingreso
                    </button>
                    <button
                        onClick={() => setModalType('EXPENSE')}
                        className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-bold text-sm transition-all shadow-sm active:scale-95"
                    >
                        + Gasto
                    </button>
                </div>
            </header>

            <main className="flex-1 min-h-0 p-4 flex flex-col">
                <Suspense fallback={<div className="p-10 text-center text-gray-500 animate-pulse">Cargando flujo...</div>}>
                    <FlowGrid key={refreshKey} />
                </Suspense>
            </main>

            {modalType && (
                <TransactionForm
                    type={modalType}
                    onClose={() => setModalType(null)}
                    onSuccess={() => setRefreshKey(k => k + 1)}
                />
            )}
        </div>
    );
}
