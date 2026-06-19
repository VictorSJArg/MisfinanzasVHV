'use client';

import { useEffect, useState } from 'react';

interface TransactionFormProps {
    type: 'INCOME' | 'EXPENSE';
    onClose: () => void;
    onSuccess: () => void;
}

interface Category {
    id: string;
    name: string;
}

interface Account {
    id: string;
    name: string;
}

interface MetadataCategory extends Category {
    type: 'INCOME' | 'EXPENSE';
}

interface MetadataResponse {
    categories: MetadataCategory[];
    accounts: Account[];
}

export default function TransactionForm({ type, onClose, onSuccess }: TransactionFormProps) {
    const [amount, setAmount] = useState('');
    const [description, setDescription] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [categoryId, setCategoryId] = useState('');
    const [accountId, setAccountId] = useState('');
    const [status, setStatus] = useState<'PAID' | 'PENDING'>('PAID');

    const [categories, setCategories] = useState<Category[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(false);

    const [showNewCategory, setShowNewCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [creatingCategory, setCreatingCategory] = useState(false);

    useEffect(() => {
        async function fetchMeta() {
            try {
                const res = await fetch('/api/metadata');
                const data: MetadataResponse = await res.json();
                const filteredCats = data.categories
                    .filter((category) => category.type === type)
                    .map(({ id, name }) => ({ id, name }));
                setCategories(filteredCats);
                setAccounts(data.accounts);
                if (data.accounts.length > 0) setAccountId(data.accounts[0].id);
                if (filteredCats.length > 0) setCategoryId(filteredCats[0].id);
            } catch (error) {
                console.error(error);
            }
        }

        void fetchMeta();
    }, [type]);

    const handleCreateCategory = async () => {
        if (!newCategoryName.trim()) return;

        setCreatingCategory(true);
        try {
            const res = await fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newCategoryName.trim(), type })
            });

            if (res.ok) {
                const newCat = await res.json();
                setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
                setCategoryId(newCat.id);
                setNewCategoryName('');
                setShowNewCategory(false);
            } else {
                const error = await res.json();
                alert(error.error || 'Error al crear categoría');
            }
        } catch (error) {
            console.error(error);
        } finally {
            setCreatingCategory(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await fetch('/api/transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount,
                    date,
                    description,
                    type,
                    categoryId,
                    accountId,
                    status
                })
            });
            if (res.ok) {
                onSuccess();
                onClose();
            } else {
                alert('Error al guardar');
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">
                <div className={`p-4 text-white flex justify-between items-center ${type === 'INCOME' ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                    <h2 className="text-lg font-bold">Nuevo {type === 'INCOME' ? 'Ingreso' : 'Gasto'}</h2>
                    <button onClick={onClose} className="text-white/80 hover:text-white">X</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5">
                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Monto</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xl">$</span>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full pl-8 pr-4 py-3 text-3xl font-bold text-gray-800 border-b-2 border-gray-200 focus:border-blue-500 focus:outline-none transition-colors"
                                placeholder="0"
                                autoFocus
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Fecha</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full p-2 bg-gray-50 rounded border border-gray-200"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Cuenta</label>
                            <select
                                value={accountId}
                                onChange={(e) => setAccountId(e.target.value)}
                                className="w-full p-2 bg-gray-50 rounded border border-gray-200"
                            >
                                {accounts.map((account) => (
                                    <option key={account.id} value={account.id}>{account.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {type === 'EXPENSE' && (
                        <div>
                            <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">Estado</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    onClick={() => setStatus('PAID')}
                                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${status === 'PAID'
                                        ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                        }`}
                                >
                                    Pagado
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setStatus('PENDING')}
                                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${status === 'PENDING'
                                        ? 'border-amber-600 bg-amber-50 text-amber-700'
                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                        }`}
                                >
                                    Pendiente
                                </button>
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                                Si el gasto queda pendiente, esta fecha se usa como vencimiento para la bandeja y el aviso por WhatsApp.
                            </p>
                        </div>
                    )}

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-semibold text-gray-500 uppercase">Categoría</label>
                            <button
                                type="button"
                                onClick={() => setShowNewCategory(!showNewCategory)}
                                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                            >
                                {showNewCategory ? 'Cancelar' : '+ Nueva'}
                            </button>
                        </div>

                        {showNewCategory ? (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newCategoryName}
                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                    placeholder="Nombre de la categoría..."
                                    className="flex-1 p-2 bg-gray-50 rounded border border-gray-200 focus:ring-2 focus:ring-blue-500"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={handleCreateCategory}
                                    disabled={creatingCategory || !newCategoryName.trim()}
                                    className="px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50"
                                >
                                    {creatingCategory ? '...' : 'Crear'}
                                </button>
                            </div>
                        ) : (
                            <select
                                value={categoryId}
                                onChange={(e) => setCategoryId(e.target.value)}
                                className="w-full p-3 bg-gray-50 rounded-lg border border-gray-200 font-medium text-gray-700 focus:ring-2 focus:ring-blue-500"
                            >
                                {categories.map((category) => (
                                    <option key={category.id} value={category.id}>{category.name}</option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Nota (Opcional)</label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full p-2 bg-gray-50 rounded border border-gray-200"
                            placeholder="Detalle..."
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button type="button" onClick={onClose} className="flex-1 py-3 text-gray-600 hover:bg-gray-100 rounded-lg font-medium">Cancelar</button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`flex-1 py-3 text-white rounded-lg font-bold shadow-lg transform active:scale-95 transition-all ${type === 'INCOME' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'} ${loading ? 'opacity-70' : ''}`}
                        >
                            {loading ? 'Guardando...' : 'GUARDAR'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
