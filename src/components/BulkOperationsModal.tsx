'use client';

import { useState, useEffect } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';

interface Category {
    id: string;
    name: string;
    type: 'INCOME' | 'EXPENSE';
}

interface PreviewItem {
    categoryName: string;
    type: string;
    count: number;
    total: number;
}

interface BulkRow {
    id: string;
    categoryId: string;
    description: string;
    amount: string;
    isPaid: boolean;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    categories: Category[];
    granularity: 'month' | 'week' | 'day';
}

const formatMoney = (n: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
};

export default function BulkOperationsModal({ isOpen, onClose, onSuccess, categories, granularity }: Props) {
    const [activeTab, setActiveTab] = useState<'delete' | 'create'>('delete');

    // Delete tab state - date range
    const [deleteType, setDeleteType] = useState<string>('');
    const [deleteCategoryId, setDeleteCategoryId] = useState<string>('');
    const [deleteStartDate, setDeleteStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [deleteEndDate, setDeleteEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [preview, setPreview] = useState<PreviewItem[]>([]);
    const [previewTotal, setPreviewTotal] = useState({ count: 0, amount: 0 });
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Create tab state - date range
    const [createType, setCreateType] = useState<'INCOME' | 'EXPENSE'>('EXPENSE');
    const [createStartDate, setCreateStartDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [createEndDate, setCreateEndDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
    const [rows, setRows] = useState<BulkRow[]>([
        { id: '1', categoryId: '', description: '', amount: '', isPaid: false }
    ]);
    const [creating, setCreating] = useState(false);

    // Filter categories by type for create tab
    const filteredCategories = categories.filter(c => c.type === createType);



    // Fetch preview for delete
    useEffect(() => {
        if (!isOpen || activeTab !== 'delete') return;

        const fetchPreview = async () => {
            setLoadingPreview(true);
            console.log('Fetching preview with dates:', deleteStartDate, deleteEndDate);

            // Create proper ISO date strings
            const startDate = new Date(deleteStartDate + 'T00:00:00').toISOString();
            const endDate = new Date(deleteEndDate + 'T23:59:59').toISOString();
            console.log('ISO dates:', startDate, endDate);

            const params = new URLSearchParams({ startDate, endDate });
            if (deleteType) params.append('type', deleteType);
            if (deleteCategoryId) params.append('categoryId', deleteCategoryId);

            const url = `/api/transactions/bulk?${params}`;
            console.log('Fetching:', url);

            try {
                const res = await fetch(url);
                console.log('Response status:', res.status);
                const data = await res.json();
                console.log('Response data:', data);
                setPreview(data.preview || []);
                setPreviewTotal({ count: data.totalCount || 0, amount: data.totalAmount || 0 });
            } catch (e) {
                console.error('Preview fetch error:', e);
            } finally {
                setLoadingPreview(false);
            }
        };

        fetchPreview();
    }, [isOpen, activeTab, deleteStartDate, deleteEndDate, deleteType, deleteCategoryId]);

    const handleDelete = async () => {
        console.log('handleDelete called, count:', previewTotal.count);
        if (previewTotal.count === 0) {
            console.log('No transactions to delete');
            return;
        }

        const confirmMessage = `¿Estás seguro de eliminar ${previewTotal.count} transacciones por un total de ${formatMoney(previewTotal.amount)}?`;
        console.log('Showing confirm:', confirmMessage);

        if (!window.confirm(confirmMessage)) {
            console.log('User cancelled');
            return;
        }

        console.log('User confirmed, proceeding with delete...');
        setDeleting(true);
        const startDate = new Date(deleteStartDate).toISOString();
        const endDate = new Date(deleteEndDate + 'T23:59:59').toISOString();
        console.log('Date range:', { startDate, endDate });

        const params = new URLSearchParams({ startDate, endDate });
        if (deleteType) params.append('type', deleteType);
        if (deleteCategoryId) params.append('categoryId', deleteCategoryId);

        const url = `/api/transactions/bulk?${params}`;
        console.log('DELETE request to:', url);

        try {
            const res = await fetch(url, { method: 'DELETE' });
            console.log('Response status:', res.status);
            const data = await res.json();
            console.log('Response data:', data);

            if (data.success) {
                alert(`Se eliminaron ${data.deletedCount} transacciones.`);
                onSuccess();
                onClose();
            } else {
                alert('Error: ' + data.error);
            }
        } catch (e) {
            console.error('Delete error:', e);
            alert('Error de conexión');
        } finally {
            setDeleting(false);
        }
    };

    const addRow = () => {
        setRows([...rows, { id: Date.now().toString(), categoryId: '', description: '', amount: '', isPaid: false }]);
    };

    const removeRow = (id: string) => {
        if (rows.length > 1) {
            setRows(rows.filter(r => r.id !== id));
        }
    };

    const updateRow = (id: string, field: keyof BulkRow, value: any) => {
        setRows(rows.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const handleCreate = async () => {
        const validRows = rows.filter(r => r.categoryId && r.amount);

        if (validRows.length === 0) {
            alert('Agrega al menos una fila con categoría y monto.');
            return;
        }

        setCreating(true);

        const start = new Date(createStartDate + 'T12:00:00');
        const end = new Date(createEndDate + 'T12:00:00');
        const allTransactions: any[] = [];

        const daysDiff = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        console.log('Creating transactions for', daysDiff, 'days from', createStartDate, 'to', createEndDate);

        for (let i = 0; i < daysDiff; i++) {
            const currentDate = new Date(start);
            currentDate.setDate(currentDate.getDate() + i);

            const dateStr = currentDate.toISOString();
            console.log('Creating for day', i, ':', dateStr);

            validRows.forEach(r => {
                allTransactions.push({
                    categoryId: r.categoryId,
                    amount: parseFloat(r.amount.replace(/\./g, '').replace(',', '.')),
                    date: dateStr,
                    type: createType,
                    description: r.description || null,
                    status: r.isPaid ? 'PAID' : 'PENDING'
                });
            });
        }

        console.log('Total transactions to create:', allTransactions.length);

        try {
            const res = await fetch('/api/transactions/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ transactions: allTransactions })
            });
            const data = await res.json();

            if (data.success) {
                alert(`Se crearon ${data.createdCount} transacciones (${daysDiff} día(s) × ${validRows.length} fila(s)).`);
                setRows([{ id: '1', categoryId: '', description: '', amount: '', isPaid: false }]);
                onSuccess();
                onClose();
            } else {
                alert('Error: ' + (data.errors?.join('\n') || data.error));
            }
        } catch (e) {
            console.error(e);
            alert('Error de conexión');
        } finally {
            setCreating(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 flex justify-between items-center">
                    <h2 className="text-xl font-bold">⚙️ Operaciones Masivas</h2>
                    <button onClick={onClose} className="text-white/80 hover:text-white text-2xl">&times;</button>
                </div>

                {/* Tabs */}
                <div className="flex border-b">
                    <button
                        onClick={() => setActiveTab('delete')}
                        className={`flex-1 py-3 px-4 font-medium transition-colors ${activeTab === 'delete'
                            ? 'bg-rose-50 text-rose-700 border-b-2 border-rose-500'
                            : 'text-gray-500 hover:bg-gray-50'
                            }`}
                    >
                        🗑️ Borrado Masivo
                    </button>
                    <button
                        onClick={() => setActiveTab('create')}
                        className={`flex-1 py-3 px-4 font-medium transition-colors ${activeTab === 'create'
                            ? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-500'
                            : 'text-gray-500 hover:bg-gray-50'
                            }`}
                    >
                        ➕ Carga Rápida
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-6">
                    {activeTab === 'delete' ? (
                        <div className="space-y-4">
                            {/* Filters */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
                                    <input
                                        type="date"
                                        value={deleteStartDate}
                                        onChange={e => setDeleteStartDate(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
                                    <input
                                        type="date"
                                        value={deleteEndDate}
                                        onChange={e => setDeleteEndDate(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                                    <select
                                        value={deleteType}
                                        onChange={e => setDeleteType(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="">Todos</option>
                                        <option value="INCOME">Ingresos</option>
                                        <option value="EXPENSE">Gastos</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                                    <select
                                        value={deleteCategoryId}
                                        onChange={e => setDeleteCategoryId(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="">Todas</option>
                                        {categories
                                            .filter(c => !deleteType || c.type === deleteType)
                                            .map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                    </select>
                                </div>
                            </div>

                            {/* Preview */}
                            <div className="border rounded-lg overflow-hidden">
                                <div className="bg-gray-100 px-4 py-2 font-medium text-gray-700">
                                    Vista Previa
                                </div>
                                <div className="max-h-48 overflow-auto">
                                    {loadingPreview ? (
                                        <div className="p-4 text-center text-gray-500">Cargando...</div>
                                    ) : preview.length === 0 ? (
                                        <div className="p-4 text-center text-gray-500">No hay transacciones para los filtros seleccionados</div>
                                    ) : (
                                        <table className="w-full text-sm">
                                            <tbody>
                                                {preview.map((item, i) => (
                                                    <tr key={i} className="border-t">
                                                        <td className="px-4 py-2">
                                                            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${item.type === 'INCOME' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
                                                            {item.categoryName}
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-gray-500">{item.count} transacc.</td>
                                                        <td className="px-4 py-2 text-right font-medium">{formatMoney(item.total)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                                {preview.length > 0 && (
                                    <div className="bg-gray-50 px-4 py-2 border-t flex justify-between font-bold">
                                        <span>TOTAL: {previewTotal.count} transacciones</span>
                                        <span>{formatMoney(previewTotal.amount)}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Settings */}
                            <div className="grid grid-cols-2 gap-4 mb-2">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Desde</label>
                                    <input
                                        type="date"
                                        value={createStartDate}
                                        onChange={e => setCreateStartDate(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Hasta</label>
                                    <input
                                        type="date"
                                        value={createEndDate}
                                        onChange={e => setCreateEndDate(e.target.value)}
                                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                            </div>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setCreateType('INCOME')}
                                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${createType === 'INCOME'
                                            ? 'bg-emerald-500 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        📈 Ingreso
                                    </button>
                                    <button
                                        onClick={() => setCreateType('EXPENSE')}
                                        className={`flex-1 py-2 rounded-lg font-medium transition-colors ${createType === 'EXPENSE'
                                            ? 'bg-rose-500 text-white'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            }`}
                                    >
                                        📉 Gasto
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    💡 Se creará una transacción <strong>por cada día</strong> en el rango seleccionado
                                </p>
                            </div>

                            {/* Rows */}
                            <div className="border rounded-lg overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-100">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700">Categoría</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700">Descripción</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-28">Monto</th>
                                            <th className="px-3 py-2 text-center font-medium text-gray-700 w-16">Pago</th>
                                            <th className="px-3 py-2 w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(row => (
                                            <tr key={row.id} className="border-t">
                                                <td className="px-2 py-1">
                                                    <select
                                                        value={row.categoryId}
                                                        onChange={e => updateRow(row.id, 'categoryId', e.target.value)}
                                                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    >
                                                        <option value="">Seleccionar...</option>
                                                        {filteredCategories.map(c => (
                                                            <option key={c.id} value={c.id}>{c.name}</option>
                                                        ))}
                                                    </select>
                                                </td>
                                                <td className="px-2 py-1">
                                                    <input
                                                        type="text"
                                                        value={row.description}
                                                        onChange={e => updateRow(row.id, 'description', e.target.value)}
                                                        placeholder="Opcional"
                                                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                </td>
                                                <td className="px-2 py-1">
                                                    <input
                                                        type="number"
                                                        value={row.amount}
                                                        onChange={e => updateRow(row.id, 'amount', e.target.value)}
                                                        placeholder="0"
                                                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                                    />
                                                </td>
                                                <td className="px-2 py-1 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={row.isPaid}
                                                        onChange={e => updateRow(row.id, 'isPaid', e.target.checked)}
                                                        className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-gray-300 rounded cursor-pointer"
                                                    />
                                                </td>
                                                <td className="px-2 py-1 text-center">
                                                    <button
                                                        onClick={() => removeRow(row.id)}
                                                        className="text-gray-400 hover:text-rose-500 text-lg"
                                                        title="Eliminar fila"
                                                    >
                                                        ×
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                <div className="bg-gray-50 px-3 py-2 border-t">
                                    <button
                                        onClick={addRow}
                                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                                    >
                                        + Agregar fila
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="border-t px-6 py-4 flex justify-end gap-3 bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                    >
                        Cancelar
                    </button>
                    {activeTab === 'delete' ? (
                        <button
                            onClick={handleDelete}
                            disabled={deleting || previewTotal.count === 0}
                            className="px-6 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                            {deleting ? 'Eliminando...' : `🗑️ Eliminar ${previewTotal.count} transacciones`}
                        </button>
                    ) : (
                        <button
                            onClick={handleCreate}
                            disabled={creating}
                            className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
                        >
                            {creating ? 'Guardando...' : '💾 Guardar Todo'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
