'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, addMonths, endOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ThemeToggle } from '@/components/ThemeToggle';

// Dynamic import for OCR (client-side only)
const OCRScanner = dynamic(() => import('@/components/OCRScanner'), { ssr: false });
import ProjectionGrid from '@/components/ProjectionGrid';
import ExportButton from '@/components/ExportButton';
import EmailImportModal from '@/components/EmailImportModal';
import { ParsedEmailTransaction } from '@/utils/parsers/bancoSanJuanParser';

const CATEGORIES = [
    { id: 'COMBUSTIBLE', name: '⛽ Combustible' },
    { id: 'ALIMENTOS', name: '🛒 Alimentos' },
    { id: 'ENTRETENIMIENTO', name: '🎬 Entretenimiento' },
    { id: 'SERVICIOS', name: '📱 Servicios' },
    { id: 'SEGUROS', name: '🛡️ Seguros' },
    { id: 'SALUD', name: '💊 Salud' },
    { id: 'GASTRONOMIA', name: '🍔 Gastronomía' },
    { id: 'ROPA', name: '👕 Ropa' },
    { id: 'TRANSPORTE', name: '🚗 Transporte' },
    { id: 'IMPUESTOS', name: '📋 Impuestos' },
    { id: 'CARGOS', name: '💸 Cargos' },
    { id: 'NUEVOS_GASTOS', name: '💳 Nuevos Gastos de Tarjeta' },
    { id: 'OTROS', name: '📦 Otros' }
];

interface CreditCard {
    id: string;
    name: string;
    bank: string;
    lastFour: string | null;
    statements: Statement[];
}

interface Statement {
    id: string;
    closingDate: string;
    dueDate: string;
    totalAmount: number;
    minimumPayment: number | null;
    items: StatementItem[];
}

interface StatementItem {
    id: string;
    date: string;
    description: string;
    amount: number;
    amountUSD: number | null;
    installmentCurrent: number | null;
    installmentTotal: number | null;
    itemType: string;
    isRecurring: boolean;
    category: string | null;
    includeInProjection: boolean;
    projectedAmount?: number | null;
    observations?: string | null;
}

interface Projection {
    id?: string;
    cardId?: string;
    date: string;
    amount: number;
    description: string;
    type: string;
    cardName: string;
    category?: string;
    source?: 'local' | 'db';
}

// Helper to calculate projections locally for instant feedback
const calculateLocalProjections = (card: CreditCard): Projection[] => {
    const projections: Projection[] = [];
    const latestStatement = card.statements[0];

    if (!latestStatement) return projections;

    // We project 12 months ahead
    const monthsAhead = 12;

    // Unified projection logic to prevent duplicates
    latestStatement.items.forEach(item => {
        if (item.includeInProjection === false) return;

        // Priority 1: Recurring (overrides installments)
        if (item.isRecurring) {
            const amount = item.projectedAmount !== undefined && item.projectedAmount !== null ? Number(item.projectedAmount) : Number(item.amount);
            for (let i = 1; i <= monthsAhead; i++) {
                const futureDate = addMonths(new Date(latestStatement.dueDate), i);
                projections.push({
                    date: futureDate.toISOString(),
                    amount: amount,
                    description: `${item.description} (recurrente)`,
                    type: 'RECURRING',
                    cardName: card.name,
                    cardId: card.id,
                    category: item.category || 'SERVICIOS',
                    source: 'local'
                });
            }
        }
        // Priority 2: Installments
        else if (item.installmentCurrent && item.installmentTotal) {
            const remaining = item.installmentTotal - item.installmentCurrent;
            const amount = item.projectedAmount !== undefined && item.projectedAmount !== null ? Number(item.projectedAmount) : Number(item.amount);

            for (let i = 1; i <= remaining; i++) {
                const futureDate = addMonths(new Date(latestStatement.dueDate), i);
                projections.push({
                    date: futureDate.toISOString(),
                    amount: amount,
                    description: `${item.description} (${item.installmentCurrent + i}/${item.installmentTotal})`,
                    type: 'INSTALLMENT',
                    cardName: card.name,
                    cardId: card.id,
                    category: item.category || 'OTROS',
                    source: 'local'
                });
            }
        }
        // Priority 3: Virtual items (new monthly card transactions)
        else if (item.id.startsWith('virtual-') || (item as any).isVirtual) {
            const amount = item.projectedAmount !== undefined && item.projectedAmount !== null ? Number(item.projectedAmount) : Number(item.amount);
            const itemDueDate = (item as any).dueDate ? new Date((item as any).dueDate) : addMonths(new Date(latestStatement.dueDate), 1);
            projections.push({
                date: itemDueDate.toISOString(),
                amount: amount,
                description: item.description,
                type: 'PURCHASE',
                cardName: card.name,
                cardId: card.id,
                category: item.category || 'NUEVOS_GASTOS',
                source: 'local'
            });
        }
    });

    return projections;
};



export default function CreditCardsPage() {
    const [cards, setCards] = useState<CreditCard[]>([]);
    const [selectedCard, setSelectedCard] = useState<CreditCard | null>(null);
    const [serverProjections, setServerProjections] = useState<Projection[]>([]); // Renamed from projections
    const [loading, setLoading] = useState(true);
    const [showAddCard, setShowAddCard] = useState(false);
    const [showAddStatement, setShowAddStatement] = useState(false);

    // Filter & Search States
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('ALL');
    const [filterType, setFilterType] = useState('ALL');

    // Add Item Modal States
    const [showAddItem, setShowAddItem] = useState(false);
    const [newItemDesc, setNewItemDesc] = useState('');
    const [newItemAmount, setNewItemAmount] = useState('');
    const [newItemDate, setNewItemDate] = useState('');
    const [newItemCategory, setNewItemCategory] = useState('OTROS');
    const [newItemRecurrence, setNewItemRecurrence] = useState(false);

    // Calculate displayed projections merging server data (for valid persistent data) 
    // and local data (for instant feedback on selected card)
    const displayedProjections = useMemo(() => {
        if (!selectedCard) return serverProjections;

        // When a card is selected, we exclusively use the local calculation based on current items
        // to ensure consistency and avoid server-side duplicates or outdated logic.
        return calculateLocalProjections(selectedCard);
    }, [selectedCard, serverProjections]);

    const [selectedStatementId, setSelectedStatementId] = useState<string>('');
    const [showEmailImport, setShowEmailImport] = useState(false);



    // Form states
    const [newCardName, setNewCardName] = useState('');
    const [newCardBank, setNewCardBank] = useState('');
    const [newCardLastFour, setNewCardLastFour] = useState('');

    // Statement form
    const [statementClosingDate, setStatementClosingDate] = useState('');
    const [statementDueDate, setStatementDueDate] = useState('');
    const [statementTotal, setStatementTotal] = useState('');
    const [statementMinPayment, setStatementMinPayment] = useState('');
    const [statementItems, setStatementItems] = useState<{
        date: string;
        description: string;
        amount: string;
        amountUSD: string;
    }[]>([{ date: '', description: '', amount: '', amountUSD: '' }]);

    const [importMethod, setImportMethod] = useState<'ocr' | 'pdf'>('ocr');
    const [pdfProcessing, setPdfProcessing] = useState(false);

    const fetchCards = useCallback(async () => {
        try {
            const res = await fetch('/api/credit-cards');
            const data = await res.json();
            setCards(data);

            // If we have a selected card, update it with the fresh data
            if (selectedCard) {
                const updated = data.find((c: CreditCard) => c.id === selectedCard.id);
                if (updated) setSelectedCard(updated);
            }
            // If no card selected and we have cards, select the first one
            else if (data.length > 0) {
                setSelectedCard(data[0]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, [selectedCard]);

    // Update selectedStatementId when selectedCard changes
    useEffect(() => {
        if (selectedCard && selectedCard.statements.length > 0) {
            // Default to the first (latest) statement if none selected or if switching cards
            // Only strictly needed if we want to reset on card switch. 
            // Better behavior: if currently selected ID exists in new card (unlikely for strict ID) -> keep.
            // Actually, statements have unique IDs, so we should always reset to first when card changes.
            // However, selectedCard updates happen on edit too, so we must be careful not to reset user selection during edits.

            // If selectedStatementId is empty/invalid for this card, select the first one.
            const exists = selectedCard.statements.find(s => s.id === selectedStatementId);
            if (!selectedStatementId || !exists) {
                setSelectedStatementId(selectedCard.statements[0].id);
            }
        }
    }, [selectedCard, selectedStatementId]);


    const fetchProjections = async () => {
        try {
            const res = await fetch('/api/credit-cards/projections');
            const data = await res.json();
            setServerProjections(data.projections || []);
        } catch (error) {
            console.error(error);
        }
    };

    useEffect(() => {
        fetchCards();
        fetchProjections();
    }, []);

    const handleAddCard = async () => {
        if (!newCardName || !newCardBank) return;

        try {
            const res = await fetch('/api/credit-cards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newCardName,
                    bank: newCardBank,
                    lastFour: newCardLastFour || null
                })
            });

            if (res.ok) {
                setNewCardName('');
                setNewCardBank('');
                setNewCardLastFour('');
                setShowAddCard(false);
                fetchCards();
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleDeleteCard = async (id: string) => {
        if (!confirm('¿Eliminar esta tarjeta y todos sus resúmenes?')) return;

        try {
            await fetch(`/api/credit-cards?id=${id}`, { method: 'DELETE' });
            if (selectedCard?.id === id) setSelectedCard(null);
            fetchCards();
        } catch (error) {
            console.error(error);
        }
    };

    const handleAddStatement = async () => {
        // Validate required fields
        const errors: string[] = [];
        if (!selectedCard) errors.push('Selecciona una tarjeta');
        if (!statementClosingDate) errors.push('Fecha de cierre');
        if (!statementDueDate) errors.push('Fecha de vencimiento');
        if (!statementTotal) errors.push('Saldo total');

        if (errors.length > 0) {
            alert(`Faltan datos requeridos:\n• ${errors.join('\n• ')}`);
            return;
        }

        // Prepare items
        const validItems = statementItems
            .filter(i => i.description && i.amount)
            .map(i => ({
                date: i.date || statementClosingDate,
                description: i.description,
                amount: parseFloat(i.amount.replace(/[^\d.-]/g, '')),
                amountUSD: i.amountUSD ? parseFloat(i.amountUSD.replace(/[^\d.-]/g, '')) : null
            }));

        console.log('Guardando resumen:', {
            creditCardId: selectedCard!.id,
            closingDate: statementClosingDate,
            dueDate: statementDueDate,
            totalAmount: statementTotal,
            itemsCount: validItems.length
        });

        try {
            const res = await fetch('/api/credit-cards/statements', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creditCardId: selectedCard!.id,
                    closingDate: statementClosingDate,
                    dueDate: statementDueDate,
                    totalAmount: statementTotal,
                    minimumPayment: statementMinPayment || null,
                    items: validItems
                })
            });

            const data = await res.json();

            if (res.ok) {
                alert(`✅ Resumen guardado con ${validItems.length} consumos`);
                setShowAddStatement(false);
                setStatementClosingDate('');
                setStatementDueDate('');
                setStatementTotal('');
                setStatementMinPayment('');
                setStatementItems([{ date: '', description: '', amount: '', amountUSD: '' }]);
                fetchCards();
                fetchProjections();
            } else {
                alert(`❌ Error al guardar: ${data.error || 'Error desconocido'}`);
            }
        } catch (error) {
            console.error(error);
            alert('❌ Error de conexión al guardar');
        }
    };

    const handleUpdateItem = async (itemId: string, updates: Record<string, any>) => {
        if (!selectedCard || !currentStatement) return;

        // Save original state for revert
        const originalCards = [...cards];
        const originalSelectedCard = { ...selectedCard };

        // 1. Optimistic Update (UI)
        const cardId = selectedCard.id;
        const newCards = cards.map(c => {
            if (c.id === cardId) {
                const newStatements = c.statements.map(s => {
                    if (s.id === currentStatement.id) {
                        // Check if item exists in current statement items
                        const itemExists = s.items.some(i => i.id === itemId);

                        let newItems = [...s.items];
                        if (itemExists) {
                            newItems = s.items.map(i => i.id === itemId ? { ...i, ...updates } : i);
                        } else if (itemId.startsWith('ghost-')) {
                            // It's a ghost item being "realized". We might need to add it to the list temporarily.
                            // But usually the ghost item is passed into ProjectionGrid via 'statementItems' prop which is mergedItems.
                            // So updating 'cards' state might not immediately reflect in 'mergedItems' logic unless we refresh.
                            // But let's try to update if we can find it in the ghost source? 
                            // Actually, simpler: just let the optimistic update happen via re-fetch or assume server fast enough.
                            // For now, let's just proceed to Server Side logic which is clearer.
                        }

                        return { ...s, items: newItems };
                    }
                    return s;
                });
                return { ...c, statements: newStatements };
            }
            return c;
        });

        // Update local state - skipping complex optimistic logic for ghost items for reliability first
        if (!itemId.startsWith('ghost-')) {
            setCards(newCards);
            const newSelectedCard = newCards.find(c => c.id === cardId);
            if (newSelectedCard) setSelectedCard(newSelectedCard);
        }

        try {
            if (itemId.startsWith('ghost-')) {
                // Handling Ghost Item: CREATE it instead of UPDATE
                // 1. Recover original item data. 
                // The ghost ID is `ghost-${prevItem.id}`.
                const originalId = itemId.replace('ghost-', '');

                // We need to find the original item properties. 
                // We assume 'cards' / 'selectedCard' is the source of truth and order is preserved.
                // Use EXACT SAME logic as the rendering part (lines 1056+) to find prevStatement
                const currentIdx = selectedCard.statements.findIndex(s => s.id === currentStatement.id);
                // In rendering logic: const prevStatement = currentIndex !== -1 && currentIndex + 1 < selectedCard.statements.length ...

                const prevStatement = (currentIdx !== -1 && currentIdx + 1 < selectedCard.statements.length)
                    ? selectedCard.statements[currentIdx + 1]
                    : null;

                if (!prevStatement) {
                    throw new Error("No previous statement found to source projection");
                }

                const originalItem = prevStatement.items.find(i => i.id === originalId);

                if (!originalItem) {
                    throw new Error(`Could not find source item (ID: ${originalId}) in statement ${prevStatement.dueDate}`);
                }

                // Prepare new Item payload
                const newItemPayload = {
                    statementId: currentStatement.id,
                    description: originalItem.description, // Keep original description (or update if user edited it?)
                    // If user edited description in this call, 'updates' has it.
                    ...updates, // This overrides description/amount if edited
                    // Logic for fields not in 'updates' but needed from original:
                    date: currentStatement.dueDate, // Use current statement date or calculate? Roughly today or statement date.
                    category: originalItem.category,
                    itemType: originalItem.itemType,
                    isRecurring: originalItem.isRecurring,
                    includeInProjection: updates.includeInProjection ?? true, // If they clicked check, this is key.
                    // Installment logic
                    installmentTotal: originalItem.installmentTotal,
                    installmentCurrent: originalItem.installmentCurrent ? originalItem.installmentCurrent + 1 : null,
                    amount: originalItem.amount, // Default to same amount
                    amountUSD: originalItem.amountUSD
                };

                const res = await fetch('/api/credit-cards/items', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newItemPayload)
                });

                if (!res.ok) {
                    const errData = await res.json();
                    throw new Error(errData.error || "Failed to create projected item");
                }

            } else {
                // Normal Update
                const res = await fetch('/api/credit-cards/items', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: itemId, ...updates })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || 'Update failed');
                }
            }

            // Success path
            fetchProjections();
            const freshRes = await fetch('/api/credit-cards');
            const freshData = await freshRes.json();
            setCards(freshData);
            const freshSelected = freshData.find((c: any) => c.id === cardId);
            if (freshSelected) setSelectedCard(freshSelected);

        } catch (error) {
            console.error(error);
            alert('Error al actualizar el ítem');
            setCards(originalCards);
            setSelectedCard(originalSelectedCard);
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        if (!confirm('¿Eliminar este consumo?')) return;

        try {
            const res = await fetch(`/api/credit-cards/items?id=${itemId}`, { method: 'DELETE' });
            if (res.ok) {
                fetchCards();
                fetchProjections();
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleDeleteStatement = async (statementId: string) => {
        if (!confirm('¿Eliminar este resumen completo? Se eliminarán todos sus consumos.')) return;

        try {
            const res = await fetch(`/api/credit-cards/statements?id=${statementId}`, { method: 'DELETE' });
            if (res.ok) {
                alert('✅ Resumen eliminado');
                fetchCards();
                fetchProjections();
            } else {
                alert('Error al eliminar');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleUpdateStatement = async (statementId: string, updates: Record<string, any>) => {
        try {
            const res = await fetch('/api/credit-cards/statements', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: statementId, ...updates })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Update failed');
            }

            fetchCards();
            fetchProjections();
        } catch (error) {
            console.error(error);
            alert('Error al actualizar el resumen');
        }
    };

    const addStatementRow = () => {
        setStatementItems([...statementItems, { date: '', description: '', amount: '', amountUSD: '' }]);
    };

    const updateStatementRow = (index: number, field: string, value: string) => {
        const newItems = [...statementItems];
        (newItems[index] as any)[field] = value;
        setStatementItems(newItems);
    };

    const removeStatementRow = (index: number) => {
        if (statementItems.length > 1) {
            setStatementItems(statementItems.filter((_, i) => i !== index));
        }
    };

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val);
    };

    // Calcular proyecciones mensuales
    const getMonthlyProjections = () => {
        const months: Record<string, { installments: number; recurring: number; statement: number }> = {};

        displayedProjections.forEach(p => {
            const monthKey = format(new Date(p.date), 'yyyy-MM');
            if (!months[monthKey]) {
                months[monthKey] = { installments: 0, recurring: 0, statement: 0 };
            }

            if (p.type === 'STATEMENT') {
                months[monthKey].statement += p.amount;
            } else if (p.type === 'INSTALLMENT') {
                months[monthKey].installments += p.amount;
            } else {
                months[monthKey].recurring += p.amount;
            }
        });

        return Object.entries(months)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(0, 12);
    };

    const currentStatement = useMemo(() => {
        if (!selectedCard?.statements) return null;
        return selectedCard.statements.find(s => s.id === selectedStatementId) || selectedCard.statements[0];
    }, [selectedCard, selectedStatementId]);

    // Filtered items logic
    const filteredItems = useMemo(() => {
        if (!currentStatement) return [];
        return currentStatement.items.filter(item => {
            const matchesSearch = item.description.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesCategory = filterCategory === 'ALL' || item.category === filterCategory;

            let matchesType = true;
            if (filterType === 'RECURRING') matchesType = item.isRecurring;
            if (filterType === 'INSTALLMENT') matchesType = !!item.installmentTotal;
            if (filterType === 'ONE_OFF') matchesType = !item.isRecurring && !item.installmentTotal;

            if (filterType === 'ONE_OFF') matchesType = !item.isRecurring && !item.installmentTotal;

            return matchesSearch && matchesCategory && matchesType;
        });
    }, [currentStatement, searchTerm, filterCategory, filterType]);

    // Calculations for totals
    const { sumOfItems, difference } = useMemo(() => {
        if (!currentStatement) return { sumOfItems: 0, difference: 0 };

        // Sum all items in the current filtered view? Or all items in the statement?
        // Usually, the balance check should be against ALL items in the statement, 
        // regardless of the search/filter, to match the "Total Statement" amount.
        // However, if the user added items that are not in the filter, it might be confusing.
        // Let's sum ALL items in the statement for the balance check.

        const sum = currentStatement.items.reduce((acc, item) => {
            const val = Number(item.amount);
            return acc + (isNaN(val) ? 0 : val);
        }, 0);

        const total = Number(currentStatement.totalAmount);
        const safeTotal = isNaN(total) ? 0 : total;

        const diff = safeTotal - sum;

        return { sumOfItems: sum, difference: diff };
    }, [currentStatement]);

    const handleAddItem = async () => {
        if (!currentStatement) return;
        if (!newItemDesc || !newItemAmount || !newItemDate) {
            alert('Por favor complete todos los campos requeridos');
            return;
        }

        try {
            const res = await fetch('/api/credit-cards/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    statementId: currentStatement.id,
                    description: newItemDesc,
                    amount: newItemAmount,
                    date: newItemDate,
                    category: newItemCategory,
                    includeInProjection: true
                })
            });

            if (res.ok) {
                setShowAddItem(false);
                setNewItemDesc('');
                setNewItemAmount('');
                setNewItemDate('');
                setNewItemCategory('OTROS');
                fetchCards();
                fetchProjections();
            } else {
                const data = await res.json();
                alert(`Error: ${data.error}`);
            }

        } catch (error) {
            console.error(error);
        }
    };

    const handleImportEmail = async (data: ParsedEmailTransaction, manualStatementDate?: string) => {
        try {
            const res = await fetch('/api/credit-cards/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...data, manualStatementDate })
            });

            const result = await res.json();

            if (res.ok) {
                alert(`✅ Importado correctamente a la tarjeta ${result.statement.creditCardId}\nResumen: ${result.statement.dueDate}`);
                fetchCards(); // Refresh data
                fetchProjections();
                setShowEmailImport(false);
            } else {
                alert(`Error al importar: ${result.error}`);
            }
        } catch (error) {
            console.error(error);
            alert('Error al conectar con el servidor');
        }
    };

    if (loading) {
        return (
            <div className="p-6 animate-pulse">
                <div className="h-8 bg-gray-200 dark:bg-slate-700 rounded w-1/3 mb-4"></div>
                <div className="h-64 bg-gray-200 dark:bg-slate-700 rounded"></div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Link
                        href="/flow"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium hover:underline flex items-center gap-1"
                    >
                        ← Volver al Flujo
                    </Link>
                    <h1 className="text-2xl font-bold text-gray-800 dark:text-slate-100 flex items-center gap-2">
                        💳 Tarjetas de Crédito
                    </h1>
                </div>
                <div className="flex gap-2">
                    <ThemeToggle />
                    <ExportButton />
                    <button
                        onClick={() => setShowAddCard(true)}
                        className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg font-medium hover:from-blue-600 hover:to-indigo-600 transition-all"
                    >
                        + Nueva Tarjeta
                    </button>
                </div>
            </div>

            {/* Cards List */}
            <div className="flex gap-4 mb-6 overflow-x-auto pb-2">
                {cards.map(card => (
                    <div
                        key={card.id}
                        onClick={() => setSelectedCard(card)}
                        className={`min-w-[200px] p-4 rounded-xl cursor-pointer transition-all ${selectedCard?.id === card.id
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg scale-105'
                            : 'bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow'
                            }`}
                    >
                        <div className="flex justify-between items-start">
                            <div>
                                <p className={`text-sm ${selectedCard?.id === card.id ? 'text-indigo-100' : 'text-gray-500 dark:text-slate-400'}`}>
                                    {card.bank}
                                </p>
                                <p className={`font-bold ${selectedCard?.id !== card.id ? 'dark:text-slate-100' : ''}`}>{card.name}</p>
                                {card.lastFour && (
                                    <p className={`text-sm ${selectedCard?.id === card.id ? 'text-indigo-200' : 'text-gray-400 dark:text-slate-500'}`}>
                                        •••• {card.lastFour}
                                    </p>
                                )}
                            </div>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteCard(card.id); }}
                                className={`p-1 rounded hover:bg-white/20 ${selectedCard?.id === card.id ? 'text-white' : 'text-gray-400 dark:text-slate-500'}`}
                            >
                                🗑️
                            </button>
                        </div>
                        {card.statements[0] && (
                            <div className={`mt-3 pt-3 border-t ${selectedCard?.id === card.id ? 'border-white/20' : 'border-gray-100 dark:border-slate-700'}`}>
                                <p className={`text-xs ${selectedCard?.id === card.id ? 'text-indigo-200' : 'text-gray-500 dark:text-slate-400'}`}>
                                    Saldo actual
                                </p>
                                <p className={`font-bold text-lg ${selectedCard?.id !== card.id ? 'dark:text-slate-100' : ''}`}>
                                    {formatMoney(Number(card.statements[0].totalAmount))}
                                </p>
                            </div>
                        )}
                    </div>
                ))}

                {cards.length === 0 && (
                    <div className="text-center text-gray-500 dark:text-slate-400 py-8 w-full">
                        No hay tarjetas registradas. Agrega una para comenzar.
                    </div>
                )}
            </div>

            {/* Selected Card Details - Full Width */}
            {selectedCard && (
                <div className="space-y-6">
                    {/* Current Statement - Full Width */}
                    <div className="bg-card rounded-xl border border-border p-6 shadow-sm overflow-hidden text-card-foreground">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                            <div>
                                <h2 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center gap-2">
                                    📄 Resumen: <span className="text-foreground capitalize">{currentStatement ? format(new Date(currentStatement.dueDate), 'MMMM yyyy', { locale: es }) : 'Seleccione'}</span>
                                </h2>        <select
                                    value={currentStatement?.id || ''}
                                    onChange={(e) => setSelectedStatementId(e.target.value)}
                                    className="text-sm font-medium border-border rounded-md focus:ring-indigo-500 focus:border-indigo-500 bg-input text-foreground py-1"
                                >
                                    {selectedCard.statements.map(stmt => (
                                        <option key={stmt.id} value={stmt.id}>
                                            {format(new Date(stmt.dueDate), 'dd/MM/yyyy')}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowAddStatement(true)}
                                    className="text-sm px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                                >
                                    + Cargar Resumen
                                </button>
                                {currentStatement && (
                                    <button
                                        onClick={() => handleDeleteStatement(currentStatement.id)}
                                        className="text-sm px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                                        title="Eliminar este resumen"
                                    >
                                        🗑️ Eliminar
                                    </button>
                                )}
                            </div>
                        </div>

                        {currentStatement ? (
                            <div>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="bg-muted p-3 rounded-lg flex flex-col justify-center">
                                        <p className="text-xs text-muted-foreground mb-1">Vencimiento</p>
                                        <input
                                            type="date"
                                            key={`date-${currentStatement.id}-${currentStatement.dueDate}`}
                                            defaultValue={format(new Date(currentStatement.dueDate), 'yyyy-MM-dd')}
                                            onBlur={(e) => {
                                                const newDate = new Date(e.target.value);
                                                // Avoid timezone drift by parsing YYYY-MM-DD
                                                if (e.target.value && e.target.value !== format(new Date(currentStatement.dueDate), 'yyyy-MM-dd')) {
                                                    handleUpdateStatement(currentStatement.id, { dueDate: e.target.value });
                                                }
                                            }}
                                            className="font-semibold text-foreground bg-transparent border border-transparent hover:border-border focus:border-indigo-500 rounded px-1 py-0.5 outline-none -ml-1 transition-colors cursor-pointer w-full max-w-[150px]"
                                        />
                                    </div>
                                    <div className="bg-gradient-to-br from-rose-50 to-red-50 dark:from-rose-900/30 dark:to-red-900/30 p-3 rounded-lg flex flex-col justify-center">
                                        <p className="text-xs text-rose-600 dark:text-rose-400 mb-1">Saldo Total</p>
                                        <div className="flex items-center">
                                            <span className="font-bold text-rose-700 dark:text-rose-300 text-lg mr-1">$</span>
                                            <input
                                                type="number"
                                                key={`total-${currentStatement.id}-${currentStatement.totalAmount}`}
                                                defaultValue={Number(currentStatement.totalAmount)}
                                                onBlur={(e) => {
                                                    const val = parseFloat(e.target.value);
                                                    if (!isNaN(val) && val !== Number(currentStatement.totalAmount)) {
                                                        handleUpdateStatement(currentStatement.id, { totalAmount: val });
                                                    }
                                                }}
                                                className="font-bold text-rose-700 dark:text-rose-300 text-lg bg-transparent border border-transparent hover:border-rose-300 dark:hover:border-rose-700 focus:border-rose-500 rounded px-1 py-0.5 outline-none -ml-1 transition-colors w-full max-w-[150px]"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Toolbar */}
                                <div className="flex flex-wrap gap-3 mb-4 items-center bg-muted/50 p-2 rounded-lg border border-border">
                                    <div className="flex-1 min-w-[200px]">
                                        <input
                                            type="text"
                                            placeholder="🔍 Buscar concepto..."
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                            className="w-full text-sm border-border rounded-md focus:ring-indigo-500 focus:border-indigo-500 bg-input text-foreground placeholder-muted-foreground"
                                        />
                                    </div>
                                    <select
                                        value={filterCategory}
                                        onChange={e => setFilterCategory(e.target.value)}
                                        className="text-sm border-border rounded-md focus:ring-indigo-500 focus:border-indigo-500 bg-input text-foreground"
                                    >
                                        <option value="ALL">Todas las Categorías</option>
                                        {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                    <select
                                        value={filterType}
                                        onChange={e => setFilterType(e.target.value)}
                                        className="text-sm border-border rounded-md focus:ring-indigo-500 focus:border-indigo-500 bg-input text-foreground"
                                    >
                                        <option value="ALL">Todos los Tipos</option>
                                        <option value="PURCHASE">Compras</option>
                                        <option value="RECURRING">Recurrentes</option>
                                        <option value="INSTALLMENT">Cuotas</option>
                                        <option value="ONE_OFF">Únicos</option>
                                    </select>
                                    <button
                                        onClick={() => {
                                            setNewItemDate(format(new Date(), 'yyyy-MM-dd'));
                                            setShowAddItem(true);
                                        }}
                                        className="bg-indigo-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-1"
                                    >
                                        <span>+</span> Nuevo
                                    </button>
                                </div>

                                <div className="overflow-x-auto">
                                    <div className="max-h-[500px] overflow-y-auto">
                                        <table className="w-full text-sm min-w-[900px]">
                                            <thead className="bg-muted/50 sticky top-0 z-10">
                                                <tr>
                                                    <th className="text-left px-3 py-2 text-muted-foreground font-semibold" style={{ width: '35%' }}>Concepto</th>
                                                    <th className="text-center px-2 py-2 text-muted-foreground font-semibold w-24">Cuotas</th>
                                                    <th className="text-left px-2 py-2 font-medium text-muted-foreground font-normal">Categoría</th>
                                                    <th className="text-left px-2 py-2 font-medium text-muted-foreground font-normal">Tipo</th>
                                                    <th className="text-right px-2 py-2 font-medium text-muted-foreground font-normal">Monto</th>
                                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground font-normal w-24">Obs</th>
                                                    <th className="text-right px-2 py-2 font-medium text-muted-foreground font-normal" title="Monto Proyectado">Proy.</th>
                                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground font-normal" title="Incluir en Proyección">Inc.</th>
                                                    <th className="text-center px-2 py-2 font-medium text-muted-foreground font-normal">Acciones</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredItems.map(item => {
                                                    const isVirtual = item.id.startsWith('virtual-') || (item as any).isVirtual;
                                                    return (
                                                    <tr key={`${item.id}-${item.category}-${item.itemType}-${item.isRecurring}-${item.includeInProjection}-${item.projectedAmount}`} className="border-b border-border hover:bg-muted/50 group">
                                                        <td className="px-2 py-2">
                                                            <input
                                                                type="text"
                                                                key={`desc-${item.id}-${item.description}`}
                                                                defaultValue={item.description}
                                                                disabled={isVirtual}
                                                                onBlur={(e) => {
                                                                    if (e.target.value !== item.description) {
                                                                        handleUpdateItem(item.id, { description: e.target.value });
                                                                    }
                                                                }}
                                                                className="block w-full text-foreground bg-transparent border-0 focus:ring-1 focus:ring-indigo-400 rounded px-1 py-0.5 font-medium"
                                                            />
                                                            <span className="text-xs text-gray-400 dark:text-slate-500">
                                                                {format(new Date(item.date), 'dd/MM/yy')}
                                                            </span>
                                                        </td>
                                                        <td className="px-2 py-2 text-center">
                                                            {item.installmentTotal ? (
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <div className="flex items-center gap-0.5">
                                                                        <input
                                                                            type="number"
                                                                            className="w-6 text-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 border-0 border-b border-border focus:ring-0 focus:border-indigo-500 p-0 bg-transparent"
                                                                            defaultValue={item.installmentCurrent || 1}
                                                                            disabled={isVirtual}
                                                                            onBlur={(e) => {
                                                                                const val = parseInt(e.target.value);
                                                                                if (!isNaN(val) && val !== item.installmentCurrent) {
                                                                                    handleUpdateItem(item.id, { installmentCurrent: val });
                                                                                }
                                                                            }}
                                                                        />
                                                                        <span className="text-muted-foreground">/</span>
                                                                        <input
                                                                            type="number"
                                                                            className="w-6 text-center text-xs font-semibold text-indigo-600 dark:text-indigo-400 border-0 border-b border-border focus:ring-0 focus:border-indigo-500 p-0 bg-transparent"
                                                                            defaultValue={item.installmentTotal}
                                                                            disabled={isVirtual}
                                                                            onBlur={(e) => {
                                                                                const val = parseInt(e.target.value);
                                                                                if (!isNaN(val) && val !== item.installmentTotal) {
                                                                                    handleUpdateItem(item.id, { installmentTotal: val });
                                                                                }
                                                                            }}
                                                                        />
                                                                    </div>
                                                                    <span className="text-[10px] text-muted-foreground">
                                                                        Faltan {(item.installmentTotal - (item.installmentCurrent || 0))}
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <span className="text-gray-300 dark:text-slate-600">-</span>
                                                            )}
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            <select
                                                                value={item.category || 'OTROS'}
                                                                disabled={isVirtual}
                                                                onChange={(e) => handleUpdateItem(item.id, { category: e.target.value })}
                                                                className="w-full text-xs border border-border rounded px-1 py-1 bg-input text-foreground cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
                                                            >
                                                                <option value="COMBUSTIBLE">⛽ Combustible</option>
                                                                <option value="ALIMENTOS">🛒 Alimentos</option>
                                                                <option value="ENTRETENIMIENTO">🎬 Entretenimiento</option>
                                                                <option value="SERVICIOS">📱 Servicios</option>
                                                                <option value="SEGUROS">🛡️ Seguros</option>
                                                                <option value="SALUD">💊 Salud</option>
                                                                <option value="GASTRONOMIA">🍔 Gastronomía</option>
                                                                <option value="ROPA">👕 Ropa</option>
                                                                <option value="TRANSPORTE">🚗 Transporte</option>
                                                                <option value="IMPUESTOS">📋 Impuestos</option>
                                                                <option value="CARGOS">💸 Cargos</option>
                                                                <option value="NUEVOS_GASTOS">💳 Nuevos Gastos</option>
                                                                <option value="OTROS">📦 Otros</option>
                                                            </select>
                                                        </td>
                                                        <td className="px-2 py-2">
                                                            <select
                                                                value={item.itemType}
                                                                disabled={isVirtual}
                                                                onChange={(e) => handleUpdateItem(item.id, { itemType: e.target.value })}
                                                                className="w-full text-xs border border-border rounded px-1 py-1 bg-input text-foreground cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
                                                            >
                                                                <option value="PURCHASE">🛒 Compra</option>
                                                                <option value="RECURRING">🔄 Recurrente</option>
                                                                <option value="PAYMENT">💰 Pago</option>
                                                                <option value="FEE">💸 Intereses</option>
                                                                <option value="TAX">📋 Impuestos</option>
                                                            </select>
                                                        </td>
                                                        <td className="px-2 py-2 text-right">
                                                            <input
                                                                type="number"
                                                                key={`amount-${item.id}-${item.amount}`}
                                                                defaultValue={Number(item.amount)}
                                                                disabled={isVirtual}
                                                                onBlur={(e) => {
                                                                    const newAmount = parseFloat(e.target.value);
                                                                    if (newAmount !== Number(item.amount)) {
                                                                        handleUpdateItem(item.id, { amount: newAmount });
                                                                    }
                                                                }}
                                                                className="w-full text-right font-medium text-foreground bg-transparent border-0 focus:ring-1 focus:ring-indigo-400 rounded px-1 py-0.5"
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 text-center">
                                                            <input
                                                                type="text"
                                                                key={`obs-${item.id}-${item.observations}`}
                                                                defaultValue={item.observations || ''}
                                                                disabled={isVirtual}
                                                                onBlur={(e) => {
                                                                    if (e.target.value !== (item.observations || '')) {
                                                                        handleUpdateItem(item.id, { observations: e.target.value });
                                                                    }
                                                                }}
                                                                placeholder="..."
                                                                className="w-full text-center text-xs text-muted-foreground bg-transparent border-0 focus:ring-1 focus:ring-indigo-400 rounded px-1 py-0.5 italic placeholder:text-muted-foreground/50"
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 text-right">
                                                            <input
                                                                type="number"
                                                                value={item.projectedAmount !== null && item.projectedAmount !== undefined ? item.projectedAmount : ''}
                                                                disabled={isVirtual}
                                                                placeholder={Number(item.amount).toString()}
                                                                onChange={(e) => {
                                                                    const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                                                    handleUpdateItem(item.id, { projectedAmount: val });
                                                                }}
                                                                title="Monto para proyecciones futuras (dejar vacío para usar el monto real)"
                                                                className={`w-full text-right bg-transparent border-0 focus:ring-1 focus:ring-indigo-400 rounded px-1 py-0.5 text-xs ${item.projectedAmount ? 'font-bold text-indigo-600 dark:text-indigo-400' : 'text-muted-foreground'}`}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 text-center">
                                                            <button
                                                                onClick={() => !isVirtual && handleUpdateItem(item.id, { includeInProjection: !(item.includeInProjection ?? true) })}
                                                                disabled={isVirtual}
                                                                title={(item.includeInProjection ?? true) ? 'Excluir de proyección' : 'Incluir en proyección'}
                                                                className={`text-xs px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${(item.includeInProjection ?? true)
                                                                    ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                                                                    : 'bg-muted text-muted-foreground hover:bg-accent'
                                                                    }`}
                                                            >
                                                                {(item.includeInProjection ?? true) ? '✓' : '✗'}
                                                            </button>
                                                        </td>
                                                        <td className="px-2 py-2 text-center">
                                                            {isVirtual ? (
                                                                <span className="text-xs text-muted-foreground italic">Virtual</span>
                                                            ) : (
                                                                <div className="flex gap-1 justify-center">
                                                                    <button
                                                                        onClick={() => handleUpdateItem(item.id, { isRecurring: !item.isRecurring })}
                                                                        title={item.isRecurring ? 'Quitar recurrente' : 'Marcar como recurrente'}
                                                                        className={`text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors ${item.isRecurring ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                                                                    >
                                                                        🔄
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDeleteItem(item.id)}
                                                                        className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600 hover:bg-red-200 cursor-pointer"
                                                                        title="Eliminar"
                                                                    >
                                                                        🗑️
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Totals Footer */}
                                <div className="mt-4 pt-4 border-t border-gray-100 dark:border-slate-700 grid grid-cols-2 gap-4">
                                    <div className="flex justify-end items-center gap-2 text-sm">
                                        <span className="text-muted-foreground">Total Items:</span>
                                        <span className="font-bold text-foreground">{formatMoney(sumOfItems)}</span>
                                    </div>
                                    <div className="flex justify-end items-center gap-2 text-sm">
                                        <span className="text-muted-foreground">Diferencia (Saldo - Items):</span>
                                        <span className={`font-bold px-2 py-0.5 rounded ${Math.abs(difference) < 1 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {Math.abs(difference) < 1 ? 'Sin Saldo' : formatMoney(difference)}
                                        </span>
                                    </div>
                                </div>

                            </div>
                        ) : (
                            <div className="text-center py-8 text-gray-500 dark:text-slate-400">
                                No hay resúmenes cargados
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Projections - Full Width Below */}
            {/* Projections - Full Width Below */}
            {selectedCard && (
                <div className="mt-6 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-6">
                    <h2 className="text-lg font-bold text-gray-800 dark:text-slate-100 mb-4">📊 Proyección de Gastos TC - {selectedCard.name}</h2>
                    {(() => {
                        // Logic to merge Previous Projections into Current View
                        // 1. Find previous statement
                        const currentIndex = selectedCard.statements.findIndex(s => s.id === currentStatement?.id);
                        const prevStatement = currentIndex !== -1 && currentIndex + 1 < selectedCard.statements.length
                            ? selectedCard.statements[currentIndex + 1]
                            : null;

                        const mergedItems = [...(currentStatement?.items || [])];

                        // 2. If prev statement exists, find items that should be carried over
                        if (prevStatement && currentStatement) {
                            prevStatement.items.forEach(prevItem => {
                                // Only interested in recurring or installments not finished
                                if (!prevItem.isRecurring && (!prevItem.installmentTotal || prevItem.installmentCurrent === prevItem.installmentTotal)) {
                                    return;
                                }

                                // Check if this item (or its continuation) exists in current statement
                                // Fuzzy match: Description similar AND Amount similar OR Installment sequence
                                const existsInCurrent = currentStatement.items.some(currItem => {
                                    // Clean descriptions for comparison
                                    const cleanPrev = prevItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();
                                    const cleanCurr = currItem.description.toLowerCase().replace(/cuota \d+\/\d+/i, '').trim();

                                    const descMatch = cleanCurr.includes(cleanPrev) || cleanPrev.includes(cleanCurr);

                                    // If installment, check if current is next in sequence
                                    if (prevItem.installmentCurrent && currItem.installmentCurrent) {
                                        return descMatch && currItem.installmentCurrent === prevItem.installmentCurrent + 1;
                                    }

                                    // If recurring, simple existence
                                    return descMatch;
                                });

                                if (!existsInCurrent) {
                                    // Create a Ghost Item for projection purposes
                                    const ghostItem: StatementItem = {
                                        ...prevItem,
                                        id: `ghost-${prevItem.id}`, // Unique ID
                                        // Update Installment info for current month
                                        installmentCurrent: prevItem.installmentCurrent ? prevItem.installmentCurrent + 1 : null,
                                        // Update Date to match current statement roughly? Or keep original?
                                        // ProjectionGrid uses it for context, but mostly needs correctness of calculation.
                                        // If we don't update ID, it might conflict? We used ghost- prefix.
                                        description: `(Proyectado) ${prevItem.description}`,
                                        observations: 'Proyección automática desde resumen anterior',
                                        includeInProjection: true
                                        // Note: We don't change amount/category/etc.
                                    };

                                    // Only add if it's still valid (e.g. installment didn't finish in prev month)
                                    // If prev was 5/6, new is 6/6 -> Valid.
                                    // If prev was 6/6, new is 7/6 -> Invalid.
                                    const isValidGhost = !ghostItem.installmentTotal || (ghostItem.installmentCurrent && ghostItem.installmentCurrent <= ghostItem.installmentTotal);

                                    if (isValidGhost) {
                                        mergedItems.push(ghostItem);
                                    }
                                }
                            });
                        }

                        return (
                            <ProjectionGrid
                                projections={displayedProjections.filter(p => p.cardName === selectedCard.name)}
                                formatMoney={formatMoney}
                                showCategoryDetails={true}
                                statementItems={mergedItems}
                                onEditItem={handleUpdateItem}
                                currentStatementDate={currentStatement?.dueDate ? new Date(currentStatement.dueDate).toISOString() : undefined}
                            />
                        );
                    })()}
                </div>
            )}

            {/* General Projection Grid - Full Width when no card selected */}
            {!selectedCard && cards.length > 0 && (
                <div className="mt-6 bg-card rounded-xl border border-border p-6 text-card-foreground">
                    <h2 className="text-lg font-bold text-foreground mb-4">📊 Proyección General de Gastos TC</h2>
                    <ProjectionGrid
                        projections={displayedProjections}
                        formatMoney={formatMoney}
                        showCategoryDetails={true}
                    />
                </div>
            )}

            {/* Add Card Modal */}
            {showAddCard && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4 dark:text-slate-100">Nueva Tarjeta</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Nombre</label>
                                <input
                                    type="text"
                                    value={newCardName}
                                    onChange={e => setNewCardName(e.target.value)}
                                    placeholder="ej: VISA Oro"
                                    className="w-full border dark:border-slate-600 rounded-lg px-3 py-2 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Banco</label>
                                <input
                                    type="text"
                                    value={newCardBank}
                                    onChange={e => setNewCardBank(e.target.value)}
                                    placeholder="ej: Banco San Juan"
                                    className="w-full border dark:border-slate-600 rounded-lg px-3 py-2 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Últimos 4 dígitos (opcional)</label>
                                <input
                                    type="text"
                                    value={newCardLastFour}
                                    onChange={e => setNewCardLastFour(e.target.value)}
                                    maxLength={4}
                                    placeholder="ej: 5100"
                                    className="w-full border dark:border-slate-600 rounded-lg px-3 py-2 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-400"
                                />
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowAddCard(false)}
                                className="flex-1 px-4 py-2 border dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-100"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAddCard}
                                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Item Modal */}
            {showAddItem && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-slate-900 rounded-xl p-6 w-full max-w-md">
                        <h3 className="text-lg font-bold mb-4 dark:text-slate-100">Nuevo Concepto</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Descripción</label>
                                <input
                                    type="text"
                                    value={newItemDesc}
                                    onChange={e => setNewItemDesc(e.target.value)}
                                    placeholder="ej: Pago Netflix"
                                    className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Monto</label>
                                    <input
                                        type="number"
                                        value={newItemAmount}
                                        onChange={e => setNewItemAmount(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Fecha</label>
                                    <input
                                        type="date"
                                        value={newItemDate}
                                        onChange={e => setNewItemDate(e.target.value)}
                                        className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Categoría</label>
                                <select
                                    value={newItemCategory}
                                    onChange={e => setNewItemCategory(e.target.value)}
                                    className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                >
                                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowAddItem(false)}
                                className="flex-1 px-4 py-2 border border-border rounded-lg hover:bg-muted text-foreground"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAddItem}
                                className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-blue-700"
                            >
                                Agregar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Statement Modal */}
            {showAddStatement && selectedCard && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-card rounded-xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto border border-border text-card-foreground">
                        <h3 className="text-lg font-bold mb-4 dark:text-slate-100">Cargar Resumen - {selectedCard.name}</h3>

                        <div className="mb-6 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-xl border border-indigo-100 dark:border-indigo-800 space-y-4">
                            {/* Tab selector */}
                            <div className="flex border-b border-indigo-200 dark:border-indigo-700 pb-2">
                                <button
                                    onClick={() => setImportMethod('ocr')}
                                    className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors mr-2 ${importMethod === 'ocr' ? 'bg-indigo-600 text-white' : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'}`}
                                >
                                    📷 Escanear con Foto (OCR)
                                </button>
                                <button
                                    onClick={() => setImportMethod('pdf')}
                                    className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors mr-2 ${importMethod === 'pdf' ? 'bg-indigo-600 text-white' : 'text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40'}`}
                                >
                                    📄 Cargar PDF Digital
                                </button>
                            </div>

                            {importMethod === 'ocr' ? (
                                <div>
                                    <h4 className="font-medium text-indigo-800 dark:text-indigo-300 mb-2">📷 Escanear Resumen Completo (OCR)</h4>
                                    <OCRScanner
                                        onItemsExtracted={(items) => {
                                            setStatementItems(items.map(i => ({
                                                date: i.date,
                                                description: i.description + (i.installment ? ` ${i.installment}` : ''),
                                                amount: i.amount,
                                                amountUSD: i.amountUSD
                                            })));
                                        }}
                                        onStatementInfo={(info) => {
                                            if (info.closingDate) setStatementClosingDate(info.closingDate);
                                            if (info.dueDate) setStatementDueDate(info.dueDate);
                                            if (info.totalAmount) setStatementTotal(info.totalAmount);
                                            if (info.minimumPayment) setStatementMinPayment(info.minimumPayment);
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <h4 className="font-medium text-indigo-800 dark:text-indigo-300 mb-1">📄 Cargar Resumen en PDF (Digital)</h4>
                                    <p className="text-xs text-indigo-600 dark:text-indigo-400">
                                        Subí directamente el archivo PDF o Adobe Acrobat del resumen mensual de tu tarjeta. Se desencriptará de manera segura y se extraerán todos los datos.
                                    </p>
                                    
                                    <div className="border-2 border-dashed border-indigo-300 rounded-xl p-6 text-center hover:border-indigo-400 transition-colors bg-white dark:bg-slate-900/50">
                                        <input
                                            type="file"
                                            accept=".pdf,application/pdf"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                
                                                setPdfProcessing(true);
                                                try {
                                                    const formData = new FormData();
                                                    formData.append('file', file);
                                                    
                                                    const res = await fetch('/api/credit-cards/parse-pdf', {
                                                        method: 'POST',
                                                        body: formData
                                                    });
                                                    
                                                    const data = await res.json();
                                                    if (!res.ok) throw new Error(data.error || 'Error al procesar el PDF');
                                                    
                                                    // Auto-populate
                                                    if (data.info.closingDate) setStatementClosingDate(data.info.closingDate);
                                                    if (data.info.dueDate) setStatementDueDate(data.info.dueDate);
                                                    if (data.info.totalAmount) setStatementTotal(data.info.totalAmount);
                                                    if (data.info.minimumPayment) setStatementMinPayment(data.info.minimumPayment);
                                                    
                                                    if (data.items && data.items.length > 0) {
                                                        setStatementItems(data.items.map((i: any) => ({
                                                            date: i.date,
                                                            description: i.description + (i.installment ? ` ${i.installment}` : ''),
                                                            amount: i.amount,
                                                            amountUSD: i.amountUSD
                                                        })));
                                                        alert(`✅ PDF procesado con éxito. Se detectaron ${data.items.length} consumos.`);
                                                    } else {
                                                        alert('⚠️ PDF procesado, pero no se encontraron transacciones.');
                                                    }
                                                } catch (err: any) {
                                                    console.error(err);
                                                    alert(`Error: ${err.message}`);
                                                } finally {
                                                    setPdfProcessing(false);
                                                }
                                            }}
                                            className="hidden"
                                            id="pdf-upload"
                                            disabled={pdfProcessing}
                                        />
                                        <label
                                            htmlFor="pdf-upload"
                                            className={`cursor-pointer block ${pdfProcessing ? 'pointer-events-none' : ''}`}
                                        >
                                            {pdfProcessing ? (
                                                <div className="space-y-3 py-4">
                                                    <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto"></div>
                                                    <p className="text-indigo-600 font-medium text-sm">Procesando y desencriptando PDF digital... 🔐</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2 py-4">
                                                    <div className="text-4xl">📄</div>
                                                    <p className="text-gray-600 dark:text-gray-300 font-medium text-sm">Subir archivo PDF del Resumen</p>
                                                    <p className="text-gray-400 text-xs">Hacé clic para seleccionar o arrastrá el archivo aquí</p>
                                                    <p className="text-xs text-indigo-500 font-semibold bg-indigo-50 dark:bg-indigo-950/50 inline-block px-2 py-1 rounded">Autodesencriptado activado</p>
                                                </div>
                                            )}
                                        </label>
                                    </div>
                                </div>
                            )}

                            <div className="border-t border-indigo-200 dark:border-indigo-700 pt-4">
                                <h4 className="font-medium text-indigo-800 dark:text-indigo-300 mb-2">📧 Importar Gasto Individual (Email/Foto)</h4>
                                <p className="text-xs text-indigo-600 mb-3">
                                    Si tienes una notificación de compra por email o foto, impórtala aquí. Se agregará directamente al resumen correspondiente.
                                </p>
                                <button
                                    onClick={() => setShowEmailImport(true)}
                                    className="w-full py-2 bg-white border border-indigo-300 text-indigo-700 rounded-lg font-medium hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2"
                                >
                                    📥 Abrir Importador de Email/Foto
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 pt-4 mb-4">
                            <p className="text-sm text-gray-500 mb-3">O ingresa los datos manualmente:</p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">Fecha Cierre</label>
                                <input
                                    type="date"
                                    value={statementClosingDate}
                                    onChange={e => setStatementClosingDate(e.target.value)}
                                    className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">Fecha Vencimiento</label>
                                <input
                                    type="date"
                                    value={statementDueDate}
                                    onChange={e => setStatementDueDate(e.target.value)}
                                    className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">Saldo Total</label>
                                <input
                                    type="number"
                                    value={statementTotal}
                                    onChange={e => setStatementTotal(e.target.value)}
                                    placeholder="1149514.56"
                                    className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-foreground mb-1">Pago Mínimo</label>
                                <input
                                    type="number"
                                    value={statementMinPayment}
                                    onChange={e => setStatementMinPayment(e.target.value)}
                                    placeholder="147474"
                                    className="w-full border border-border rounded-lg px-3 py-2 bg-input text-foreground"
                                />
                            </div>
                        </div>

                        <h4 className="font-medium text-gray-700 mb-2">Consumos del Resumen ({statementItems.length} items)</h4>
                        <p className="text-xs text-gray-500 mb-3">
                            💡 Las cuotas se detectan automáticamente del formato "C.04/06".
                            Los gastos recurrentes (Netflix, Spotify, etc.) también se detectan automáticamente.
                        </p>

                        <div className="border rounded-lg overflow-hidden mb-4">
                            <table className="w-full text-sm">
                                <thead className="bg-muted">
                                    <tr>
                                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Fecha</th>
                                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Descripción</th>
                                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Monto $</th>
                                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Monto USD</th>
                                        <th className="w-10"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {statementItems.map((item, idx) => (
                                        <tr key={idx} className="border-t">
                                            <td className="px-3 py-2">
                                                <input
                                                    type="date"
                                                    value={item.date}
                                                    onChange={e => updateStatementRow(idx, 'date', e.target.value)}
                                                    className="w-full border rounded px-2 py-1 text-sm"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="text"
                                                    value={item.description}
                                                    onChange={e => updateStatementRow(idx, 'description', e.target.value)}
                                                    placeholder="ej: NETFLIX o ITALA SA C.04/06"
                                                    className="w-full border border-border rounded px-2 py-1 text-sm bg-input text-foreground"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="number"
                                                    value={item.amount}
                                                    onChange={e => updateStatementRow(idx, 'amount', e.target.value)}
                                                    placeholder="60000"
                                                    className="w-full border rounded px-2 py-1 text-sm text-right"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <input
                                                    type="number"
                                                    value={item.amountUSD}
                                                    onChange={e => updateStatementRow(idx, 'amountUSD', e.target.value)}
                                                    placeholder="20"
                                                    className="w-full border rounded px-2 py-1 text-sm text-right"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <button
                                                    onClick={() => removeStatementRow(idx)}
                                                    className="text-gray-400 hover:text-red-500"
                                                >
                                                    ✕
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <button
                            onClick={addStatementRow}
                            className="text-sm text-indigo-600 hover:text-indigo-700 mb-6"
                        >
                            + Agregar fila
                        </button>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowAddStatement(false)}
                                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAddStatement}
                                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                            >
                                Guardar Resumen
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showEmailImport && (
                <EmailImportModal
                    onClose={() => setShowEmailImport(false)}
                    onImport={handleImportEmail}
                />
            )}
        </div>
    );
}
