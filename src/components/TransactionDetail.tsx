'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Transaction {
    id: string;
    amount: number;
    date: string;
    description: string | null;
    type: string;
    category: { id: string; name: string } | null;
    account: { id: string; name: string };
}

interface TransactionDetailProps {
    categoryId: string;
    categoryName: string;
    startDate: string;
    endDate: string;
    type: 'INCOME' | 'EXPENSE';
    onClose: () => void;
    onUpdate: () => void;
}

export default function TransactionDetail({ categoryId, categoryName, startDate, endDate, type, onClose, onUpdate }: TransactionDetailProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editAmount, setEditAmount] = useState('');
    const [editDescription, setEditDescription] = useState('');

    // Estado para agregar nueva transacción
    const [isAdding, setIsAdding] = useState(false);
    const [newAmount, setNewAmount] = useState('');
    const [newDescription, setNewDescription] = useState('');

    // Estado para confirmación de borrado en dos pasos
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    useEffect(() => {
        fetchTransactions();
    }, [categoryId, startDate, endDate]);

    const fetchTransactions = async () => {
        try {
            const params = new URLSearchParams({ categoryId, startDate, endDate });
            const res = await fetch(`/api/transactions/detail?${params}`);
            const data = await res.json();
            setTransactions(data);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val);
    };

    const handleEdit = (tx: Transaction) => {
        setEditingId(tx.id);
        setEditAmount(String(tx.amount));
        setEditDescription(tx.description || '');
    };

    const handleSave = async (id: string) => {
        try {
            const res = await fetch('/api/transactions/detail', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, amount: editAmount, description: editDescription })
            });

            if (res.ok) {
                setEditingId(null);
                fetchTransactions();
                onUpdate();
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleDelete = async (id: string) => {
        // Confirmación nativa removida en favor del UI de dos pasos
        // if (!confirm('¿Eliminar esta transacción?')) return;

        try {
            const res = await fetch(`/api/transactions/detail?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                fetchTransactions();
                onUpdate();
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleAddNew = async () => {
        const amount = parseFloat(newAmount);
        if (isNaN(amount) || amount <= 0) {
            alert('Ingrese un monto válido');
            return;
        }

        try {
            const res = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount,
                    date: startDate, // Usar la fecha del inicio del período
                    type,
                    categoryId,
                    description: newDescription || null,
                    accountId: null // Usará la cuenta por defecto
                })
            });

            if (res.ok) {
                setIsAdding(false);
                setNewAmount('');
                setNewDescription('');
                fetchTransactions();
                onUpdate();
            }
        } catch (error) {
            console.error(error);
        }
    };

    const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0);

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-2xl max-h-[80vh] rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className={`p-4 text-white flex justify-between items-center ${type === 'INCOME' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                    <div>
                        <h2 className="text-lg font-bold">{categoryName}</h2>
                        <p className="text-sm opacity-80">
                            {format(new Date(startDate), 'dd MMM', { locale: es })} - {format(new Date(endDate), 'dd MMM yyyy', { locale: es })}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white text-2xl">✕</button>
                </div>

                <div className="p-4 overflow-y-auto max-h-[50vh]">
                    {loading ? (
                        <div className="text-center py-8 text-gray-500">Cargando...</div>
                    ) : (
                        <div className="space-y-2">
                            {transactions.length === 0 && !isAdding && (
                                <div className="text-center py-4 text-gray-500">No hay transacciones</div>
                            )}

                            {transactions.map((tx, i) => (
                                <div key={tx.id || i} className="bg-gray-50 rounded-lg p-3 hover:bg-gray-100 transition-colors">
                                    {editingId === tx.id ? (
                                        <div className="space-y-2">
                                            <div className="flex gap-2">
                                                <input
                                                    type="number"
                                                    value={editAmount}
                                                    onChange={e => setEditAmount(e.target.value)}
                                                    className="flex-1 p-2 border rounded text-lg font-bold"
                                                    autoFocus
                                                />
                                            </div>
                                            <input
                                                type="text"
                                                value={editDescription}
                                                onChange={e => setEditDescription(e.target.value)}
                                                placeholder="Descripción..."
                                                className="w-full p-2 border rounded text-sm"
                                            />
                                            <div className="flex gap-2 justify-end">
                                                <button

                                                    onClick={() => {
                                                        if (confirmDeleteId === tx.id) {
                                                            handleDelete(tx.id);
                                                            setConfirmDeleteId(null);
                                                        } else {
                                                            setConfirmDeleteId(tx.id);
                                                            setTimeout(() => setConfirmDeleteId(null), 3000);
                                                        }
                                                    }}
                                                    className={`px-3 py-1 rounded text-sm mr-auto transition-colors ${confirmDeleteId === tx.id
                                                        ? 'bg-red-600 text-white font-bold animate-pulse'
                                                        : 'bg-red-100 text-red-600 hover:bg-red-200'
                                                        }`}
                                                >
                                                    {confirmDeleteId === tx.id ? '¿CONFIRMAR?' : 'Eliminar'}
                                                </button>
                                                <button
                                                    onClick={() => setEditingId(null)}
                                                    className="px-3 py-1 text-gray-600 hover:bg-gray-200 rounded text-sm"
                                                >
                                                    Cancelar
                                                </button>
                                                <button
                                                    onClick={() => handleSave(tx.id)}
                                                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                                                >
                                                    Guardar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-lg font-bold ${type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {formatMoney(Number(tx.amount))}
                                                    </span>
                                                    <span className="text-gray-400 text-sm">
                                                        {format(new Date(tx.date), 'dd/MM/yyyy')}
                                                    </span>
                                                </div>
                                                {tx.description && (
                                                    <p className="text-gray-600 text-sm mt-1">{tx.description}</p>
                                                )}
                                                <p className="text-gray-400 text-xs mt-1">Cuenta: {tx.account.name}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => handleEdit(tx)}
                                                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                    title="Editar"
                                                >
                                                    ✏️
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (confirmDeleteId === tx.id) {
                                                            handleDelete(tx.id);
                                                            setConfirmDeleteId(null);
                                                        } else {
                                                            setConfirmDeleteId(tx.id);
                                                            setTimeout(() => setConfirmDeleteId(null), 3000);
                                                        }
                                                    }}
                                                    className={`p-2 rounded transition-colors ${confirmDeleteId === tx.id
                                                        ? 'bg-red-600 text-white animate-pulse font-bold px-3'
                                                        : 'text-gray-400 hover:text-rose-600 hover:bg-rose-50'
                                                        }`}
                                                    title={confirmDeleteId === tx.id ? "Confirmar eliminar" : "Eliminar"}
                                                >
                                                    {confirmDeleteId === tx.id ? '¿BORRAR?' : '🗑️'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Formulario para agregar nueva transacción */}
                            {isAdding && (
                                <div className="bg-blue-50 rounded-lg p-3 border-2 border-blue-200">
                                    <div className="space-y-2">
                                        <input
                                            type="number"
                                            value={newAmount}
                                            onChange={e => setNewAmount(e.target.value)}
                                            placeholder="Monto..."
                                            className="w-full p-2 border rounded text-lg font-bold"
                                            autoFocus
                                        />
                                        <input
                                            type="text"
                                            value={newDescription}
                                            onChange={e => setNewDescription(e.target.value)}
                                            placeholder="Descripción (opcional)..."
                                            className="w-full p-2 border rounded text-sm"
                                        />
                                        <div className="flex gap-2 justify-end">
                                            <button
                                                onClick={() => { setIsAdding(false); setNewAmount(''); setNewDescription(''); }}
                                                className="px-3 py-1 text-gray-600 hover:bg-gray-200 rounded text-sm"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleAddNew}
                                                className={`px-3 py-1 text-white rounded text-sm ${type === 'INCOME' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}
                                            >
                                                Agregar {type === 'INCOME' ? 'Ingreso' : 'Gasto'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Botón para agregar + Total */}
                <div className={`p-4 border-t ${type === 'INCOME' ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                    {!isAdding && (
                        <button
                            onClick={() => setIsAdding(true)}
                            className={`w-full mb-3 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition-colors ${type === 'INCOME'
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-rose-600 hover:bg-rose-700 text-white'
                                }`}
                        >
                            <span className="text-lg">+</span>
                            Agregar {type === 'INCOME' ? 'Ingreso' : 'Gasto'}
                        </button>
                    )}
                    <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-700">Total ({transactions.length} transacciones)</span>
                        <span className={`text-xl font-bold ${type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {formatMoney(total)}
                        </span>
                    </div>
                </div>
            </div>
        </div >
    );
}
