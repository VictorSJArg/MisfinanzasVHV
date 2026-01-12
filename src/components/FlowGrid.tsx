
'use client';

import { useState, useEffect, useRef, useCallback, Fragment, useMemo } from 'react';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, startOfWeek, endOfWeek, subWeeks, startOfDay, endOfDay, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import TransactionDetail from './TransactionDetail';
import BulkOperationsModal from './BulkOperationsModal';

interface TransactionDetail {
    id: string;
    date: string;
    amount: number;
    description: string | null;
    accountName: string;
}

interface CellDetail {
    amount: number;
    transactions: TransactionDetail[];
}

interface FlowData {
    columns: { date: string, label: string, labelMain: string, labelSub: string | null, startDate: string, endDate: string }[];
    incomeRows: RowData[];
    expenseRows: RowData[];
    summary: { income: number, expense: number, balance: number }[];
}

interface RowData {
    category: { id: string, name: string, type: string, isExpandable?: boolean, isVirtual?: boolean };
    cells: number[];
    cellDetails?: CellDetail[];
    total: number;
    subRows?: RowData[];
}

interface EditingCell {
    categoryId: string;
    columnIndex: number;
    value: string;
    detailDescription?: string | null; // Para edición de subcategorías
    transactionId?: string | null; // ID de transacción para edición directa
}

interface EditingGroup {
    categoryId: string;
    oldDescription: string | null;
    value: string;
}

interface DetailModalData {
    categoryId: string;
    categoryName: string;
    type: 'INCOME' | 'EXPENSE';
    startDate: string;
    endDate: string;
}

const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
};

export default function FlowGrid() {
    // Load saved preferences from localStorage
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
    }, []);

    const getSavedPreferences = () => {
        if (typeof window === 'undefined') return null;
        try {
            const saved = localStorage.getItem('flowGridPreferences');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    };

    const savedPrefs = getSavedPreferences();

    const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>(
        savedPrefs?.granularity || 'week'
    );
    const [currentDate, setCurrentDate] = useState(new Date());
    const [data, setData] = useState<FlowData | null>(null);
    const [loading, setLoading] = useState(true);
    const [periodsCount, setPeriodsCount] = useState(savedPrefs?.periodsCount || 6);
    const [showVariations, setShowVariations] = useState(
        savedPrefs?.showVariations !== undefined ? savedPrefs.showVariations : true
    );
    const [error, setError] = useState<string | null>(null);

    // Custom date range mode
    const [useCustomRange, setUseCustomRange] = useState(savedPrefs?.useCustomRange || false);
    const [customStartDate, setCustomStartDate] = useState<string>(
        savedPrefs?.customStartDate || format(subMonths(new Date(), 1), 'yyyy-MM-dd')
    );
    const [customEndDate, setCustomEndDate] = useState<string>(
        savedPrefs?.customEndDate || format(new Date(), 'yyyy-MM-dd')
    );

    // Estado para categorías expandidas
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [hideEmptyColumns, setHideEmptyColumns] = useState(
        savedPrefs?.hideEmptyColumns || false
    );

    // Edición de descripciones de grupo
    const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null);

    // Estado para edición inline
    const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
    const [selectedCell, setSelectedCell] = useState<{ categoryId: string, columnIndex: number } | null>(null);

    // Timer removido ya que quitamos la ambigüedad click/dblclick (ahora hacen cosas distintas inmediatas)
    // const clickTimerRef = useRef<NodeJS.Timeout | null>(null);
    const clickTimerRef = useRef<any>(null); // Dejar ref por si acaso para limpiar, aunque no se use lógica compleja
    const inputRef = useRef<HTMLInputElement>(null);

    // Caché para detalles de categorías (Lazy Loading)
    const [detailsCache, setDetailsCache] = useState<Record<string, TransactionDetail[]>>({});
    const [loadingCategories, setLoadingCategories] = useState<Set<string>>(new Set());

    // Estado para modal de detalle
    const [detailModal, setDetailModal] = useState<DetailModalData | null>(null);

    // Estado para modal de operaciones masivas
    const [bulkModalOpen, setBulkModalOpen] = useState(false);

    const fetchData = useCallback(async (includeDetails = false) => {
        setLoading(true);

        let start: Date, end: Date;

        if (useCustomRange) {
            // Use custom date range
            start = startOfDay(new Date(customStartDate + 'T12:00:00'));
            end = endOfDay(new Date(customEndDate + 'T12:00:00'));
        } else if (granularity === 'month') {
            start = startOfMonth(subMonths(currentDate, periodsCount - 1));
            end = endOfMonth(currentDate);
        } else if (granularity === 'week') {
            start = startOfWeek(subWeeks(currentDate, periodsCount - 1), { weekStartsOn: 0 });
            end = endOfWeek(currentDate, { weekStartsOn: 0 });
        } else {
            start = startOfDay(subDays(currentDate, periodsCount - 1));
            end = endOfDay(currentDate);
        }

        // Validate dates to prevent "Invalid time value" error
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            console.warn('Invalid date range detected, falling back to current month');
            start = startOfMonth(new Date());
            end = endOfMonth(new Date());
        }

        const query = new URLSearchParams({
            start: format(start, 'yyyy-MM-dd'),
            end: format(end, 'yyyy-MM-dd'),
            granularity,
            includeTransactions: includeDetails ? 'true' : 'false'
        });

        try {
            setError(null);
            const res = await fetch(`/api/flow?${query.toString()}`);
            if (!res.ok) {
                const text = await res.text();
                throw new Error(`Failed to fetch data: ${res.status} ${res.statusText} - ${text.substring(0, 100)}`);
            }
            const result = await res.json();
            setData(result);
        } catch (error: any) {
            console.error('Fetch error:', error);
            setError(error.message || 'Unknown error');
            setData(null); // Ensure data is null on error
        } finally {
            setLoading(false);
        }
    }, [granularity, currentDate, periodsCount, useCustomRange, customStartDate, customEndDate]);

    const fetchCategoryDetails = async (categoryId: string) => {
        if (!data) return;

        setLoadingCategories(prev => new Set(prev).add(categoryId));
        try {
            // Obtener rango completo de fechas de la vista actual
            const startDate = data.columns[0].startDate;
            const endDate = data.columns[data.columns.length - 1].endDate;

            const params = new URLSearchParams({ categoryId, startDate, endDate, _: Date.now().toString() });
            const res = await fetch(`/api/transactions/detail?${params}`);
            if (res.ok) {
                const transactions = await res.json();
                setDetailsCache(prev => ({ ...prev, [categoryId]: transactions }));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoadingCategories(prev => {
                const next = new Set(prev);
                next.delete(categoryId);
                return next;
            });
        }
    };

    // --- Gestión de Categorías ---
    const handleAddCategory = async (type: 'INCOME' | 'EXPENSE') => {
        const name = prompt(`Nombre de la nueva categoría de ${type === 'INCOME' ? 'Ingresos' : 'Gastos'}:`);
        if (!name) return;
        try {
            const res = await fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, type })
            });
            if (res.ok) {
                fetchData(true); // Recargar estructura
            } else {
                alert('Error al crear categoría');
            }
        } catch (e) { console.error(e); alert('Error de conexión'); }
    };

    const handleDeleteCategory = async (id: string, name: string) => {
        if (!confirm(`¿Eliminar categoría "${name}" y TODAS sus transacciones?`)) return;
        try {
            const res = await fetch(`/api/categories?id=${id}`, { method: 'DELETE' });
            if (res.ok) {
                setExpandedCategories(prev => { const n = new Set(prev); n.delete(id); return n; });
                fetchData(true);
            } else {
                alert('Error al eliminar. Verifique dependencias.');
            }
        } catch (e) { console.error(e); }
    };

    // Navegación Temporal
    const handlePrevMonth = () => setCurrentDate(prev => subMonths(prev, 1));
    const handleNextMonth = () => setCurrentDate(prev => addMonths(prev, 1));

    // Filtro Columnas
    const visibleColumnIndices = data?.columns.map((_, idx) => idx).filter(idx => {
        if (!hideEmptyColumns) return true;
        const s = data.summary[idx];
        // Visible si hay ingreso O gasto O es la columna del mes actual (opcional, pero mejor dejarla si tiene dat)
        return s && (Math.abs(s.income) > 0.01 || Math.abs(s.expense) > 0.01);
    }) || [];

    const saveCellValue = async (row: RowData, columnIndex: number, value: string, detailDescription?: string | null, transactionId?: string | null) => {
        console.log('=== SAVE START ===', {
            category: row.category.name,
            column: columnIndex,
            value,
            detailDescription,
            transactionId
        });

        if (!data) {
            console.log('ERROR: No data available');
            return;
        }

        const newAmount = value === '' ? 0 : Number(value);
        console.log('Parsed amount:', newAmount);

        // Check if amount is valid
        if (newAmount < 0 || isNaN(newAmount)) {
            console.log('Skip: Invalid amount');
            return;
        }

        const column = data.columns[columnIndex];
        const actualDescription = detailDescription === 'Sin descripción' ? null : detailDescription;

        // Try to find the transaction:
        // 1. By explicit transactionId if provided
        // 2. By description match in detailsCache (fallback)

        let existingTx: TransactionDetail | undefined;

        // Helper to ensure we have transactions to check against
        let currentCategoryTransactions = detailsCache[row.category.id];
        if (!currentCategoryTransactions) {
            console.log('Fetching details for unexpanded category:', row.category.name);
            try {
                const startDate = data.columns[0].startDate;
                const endDate = data.columns[data.columns.length - 1].endDate;
                const params = new URLSearchParams({ categoryId: row.category.id, startDate, endDate });
                const res = await fetch(`/api/transactions/detail?${params}`);
                if (res.ok) {
                    currentCategoryTransactions = await res.json();
                    // Update cache for future use
                    setDetailsCache(prev => ({ ...prev, [row.category.id]: currentCategoryTransactions }));
                } else {
                    currentCategoryTransactions = [];
                }
            } catch (e) {
                console.error('Error fetching details on save:', e);
                currentCategoryTransactions = [];
            }
        }

        if (transactionId) {
            // If we have an explicit ID, verify it exists/fetch it or trust it matches
            existingTx = currentCategoryTransactions.find(tx => tx.id === transactionId);

            // If not in cache but we have ID, we assume it exists (lazy update)
            if (!existingTx) {
                existingTx = { id: transactionId } as any;
            }
        } else {
            // Fallback to description matching logic
            const cachedTransactions = currentCategoryTransactions || [];

            // Fix: Use string comparison for dates to avoid timezone issues
            const cellTransactions = cachedTransactions.filter(tx => {
                const txDateStr = typeof tx.date === 'string' ? tx.date.substring(0, 10) : new Date(tx.date).toISOString().substring(0, 10);
                return txDateStr >= column.startDate && txDateStr <= column.endDate;
            });

            if (actualDescription === null && cellTransactions.length === 1) {
                // Heuristic: If we are editing the main row (no description targeted) 
                // and there is EXACTLY one transaction in this cell, assume we want to edit that one.
                // This fixes the case where Income row has 1 item "Sueldo" but is edited from the "Total" view.
                existingTx = cellTransactions[0];
            } else {
                // Otherwise find exact match by description
                existingTx = cellTransactions.find(tx => {
                    const descriptionMatch = tx.description === actualDescription ||
                        (actualDescription === null && tx.description === null) ||
                        (actualDescription === null && !tx.description);
                    return descriptionMatch;
                });
            }
        }

        console.log('Target transaction for update:', existingTx);

        try {
            if (existingTx && existingTx.id) {
                // UPDATE existing transaction
                if (newAmount === 0) {
                    // Delete the transaction if amount is 0
                    console.log('Deleting transaction:', existingTx.id);
                    const deleteRes = await fetch(`/api/transactions/${existingTx.id}`, {
                        method: 'DELETE'
                    });
                    if (!deleteRes.ok) {
                        const result = await deleteRes.json();
                        console.error('Delete FAILED:', result);
                        alert(`Error eliminando: ${result.error || 'Error desconocido'}`);
                        return;
                    }
                    console.log('Delete SUCCESS');
                } else {
                    // Update the transaction amount
                    console.log('Updating transaction:', existingTx.id, 'with amount:', newAmount);
                    const updateRes = await fetch(`/api/transactions/${existingTx.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ amount: newAmount })
                    });
                    const result = await updateRes.json();
                    if (!updateRes.ok) {
                        console.error('Update FAILED:', result);
                        alert(`Error actualizando: ${result.error || 'Error desconocido'}`);
                        return;
                    }
                    console.log('Update SUCCESS:', result);
                }
            } else {
                // CREATE new transaction (only if amount > 0)
                if (newAmount <= 0) {
                    console.log('Skip: Cannot create transaction with amount <= 0');
                    return;
                }

                const body = {
                    amount: newAmount,
                    date: column.startDate,
                    type: row.category.type,
                    categoryId: row.category.id,
                    accountId: null,
                    description: actualDescription || undefined
                };

                console.log('Creating new transaction:', body);
                const saveRes = await fetch('/api/transactions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });

                const result = await saveRes.json();

                if (!saveRes.ok) {
                    console.error('Save FAILED:', result);
                    alert(`Error guardando: ${result.error || 'Error desconocido'}`);
                    return;
                }

                console.log('Save SUCCESS:', result);
            }

            // Invalidar caché
            setDetailsCache(prev => {
                const next = { ...prev };
                delete next[row.category.id];
                return next;
            });

            // Expandir categoría para ver el item
            setExpandedCategories(prev => {
                const next = new Set(prev);
                next.add(row.category.id);
                return next;
            });

            // Recargar datos
            console.log('Refreshing data...');
            await fetchData(true);
            await fetchCategoryDetails(row.category.id);
            console.log('=== SAVE COMPLETE ===');

        } catch (error) {
            console.error('Save ERROR:', error);
            alert('Error de conexión al guardar');
        }
    };

    const saveGroupDescription = async (categoryId: string, oldDescription: string | null, newDescription: string) => {
        if (!detailsCache[categoryId]) return;

        const txsToUpdate = detailsCache[categoryId].filter(tx => (tx.description || '') === (oldDescription || ''));

        // Optimistic UI update
        setDetailsCache(prev => { const n = { ...prev }; delete n[categoryId]; return n; });

        try {
            await Promise.all(txsToUpdate.map(tx =>
                fetch('/api/transactions', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: tx.id,
                        description: newDescription,
                        amount: tx.amount,
                        date: tx.date,
                        categoryId,
                        accountId: null,
                        type: tx.amount > 0 ? 'INCOME' : 'EXPENSE' // Ensure type consistency if needed, though PUT backend handles optional logic
                    })
                })
            ));

            // Recargar todo correctamente
            await fetchData(true);
            await fetchCategoryDetails(categoryId);
        } catch (e) { console.error(e); }
        setEditingGroup(null);
    };

    useEffect(() => {
        const hasExpanded = expandedCategories.size > 0;
        fetchData(hasExpanded);
    }, [granularity, currentDate, periodsCount, useCustomRange, customStartDate, customEndDate]);

    // Save preferences to localStorage whenever they change
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const preferences = {
            granularity,
            periodsCount,
            showVariations,
            hideEmptyColumns,
            useCustomRange,
            customStartDate,
            customEndDate
        };
        localStorage.setItem('flowGridPreferences', JSON.stringify(preferences));
    }, [granularity, periodsCount, showVariations, hideEmptyColumns, useCustomRange, customStartDate, customEndDate]);

    // Efecto de carga global removido en favor de fetchCategoryDetails bajo demanda
    /* 
    useEffect(() => {
        const hasDetails = (data?.incomeRows?.[0]?.cellDetails) || (data?.expenseRows?.[0]?.cellDetails);
        if (expandedCategories.size > 0 && data && !hasDetails) {
            fetchData(true);
        }
    }, [expandedCategories, data]);
    */

    // Effect for focus handling removed to avoid re-selection on every keystroke
    // We will handle selection via onFocus prop on the input

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val);
    };

    const formatVariation = (current: number, previous: number) => {
        const diff = current - previous;
        if (previous === 0) {
            if (current === 0) return '-';
            return `+${formatMoney(diff)} (+∞)`;
        }
        const variation = (diff / previous) * 100;
        const sign = variation >= 0 ? '+' : '';
        const diffSign = diff >= 0 ? '+' : '';
        return `${diffSign}${formatMoney(diff)} (${sign}${variation.toFixed(0)}%)`;
    };

    const getVariationClass = (current: number, previous: number, inverted = false) => {
        if (previous === 0) return 'text-gray-400';
        const variation = ((current - previous) / previous) * 100;
        if (inverted) {
            return variation <= 0 ? 'text-emerald-600' : 'text-rose-600';
        }
        return variation >= 0 ? 'text-emerald-600' : 'text-rose-600';
    };

    const toggleCategory = (categoryId: string) => {
        setExpandedCategories(prev => {
            const newSet = new Set(prev);
            if (newSet.has(categoryId)) {
                newSet.delete(categoryId);
            } else {
                newSet.add(categoryId);
                // Si no tenemos detalles en caché, buscarlos solo para esta categoría
                if (!detailsCache[categoryId]) {
                    fetchCategoryDetails(categoryId);
                }
            }
            return newSet;
        });
    };

    const handleCellClick = (row: RowData, columnIndex: number) => {
        setSelectedCell({ categoryId: row.category.id, columnIndex });
    };

    const handleCellDoubleClick = (row: RowData, columnIndex: number, value: number) => {
        // If the category cell already has a value, prompt to add a new sub-item
        if (value > 0) {
            handleAddSubItem(row, columnIndex);
            return;
        }

        // Allow editing only if cell is empty (value = 0)
        setEditingCell({
            categoryId: row.category.id,
            columnIndex,
            value: ''
        });
    };

    // Add new sub-item to a category (when category already has values)
    const handleAddSubItem = (row: RowData, columnIndex: number) => {
        const description = prompt('Ingrese el concepto/descripción para este nuevo item:');
        if (description === null) return; // Cancelled

        setEditingCell({
            categoryId: row.category.id,
            columnIndex,
            value: '',
            detailDescription: description.trim() || null
        });

        // Make sure category is expanded to see the new item
        if (!expandedCategories.has(row.category.id)) {
            toggleCategory(row.category.id);
        }
    };

    // Subcell inputs - does NOT duplicate, uses overwrite logic in saveCellValue
    const handleSubCellDoubleClick = (categoryId: string, columnIndex: number, value: number, description: string | null, transactionId?: string) => {
        setEditingCell({
            categoryId,
            columnIndex,
            value: value > 0 ? value.toString() : '',
            detailDescription: description,
            transactionId: transactionId || null
        });
    };

    const handleCellKeyDown = async (e: React.KeyboardEvent, row: RowData, columnIndex: number) => {
        if (!editingCell) return;

        if (e.key === 'Escape') {
            setEditingCell(null);
            return;
        }

        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            saveCellValue(row, columnIndex, editingCell.value, editingCell.detailDescription);
        }
    };

    const handleDetailUpdate = () => {
        fetchData(expandedCategories.size > 0);
    };

    const toggleCellStatus = async (txs: any[]) => {
        if (!txs || txs.length === 0) return;

        // If any transaction is NOT paid, we toggle ALL to PAID.
        // Otherwise (all appear paid), we toggle ALL to PENDING.
        const targetStatus = txs.some(t => t.status !== 'PAID') ? 'PAID' : 'PENDING';

        // Optimistic UI Update for Detail View (Cache)
        const affectedCategories = new Set(txs.map(t => t.categoryId).filter(Boolean) as string[]);

        setDetailsCache(prev => {
            const next = { ...prev };
            affectedCategories.forEach(catId => {
                if (next[catId]) {
                    next[catId] = next[catId].map(t => {
                        // Check match by ID or ReferenceID
                        const match = txs.some(target =>
                            (target.id && target.id === t.id) ||
                            (target.referenceId && target.referenceId === (t as any).referenceId)
                        );
                        if (match) {
                            return { ...t, status: targetStatus } as any;
                        }
                        return t;
                    });
                }
            });
            return next;
        });

        try {
            await Promise.all(txs.map(tx => {
                if (tx.isProjection && tx.referenceId) {
                    return fetch('/api/projections/status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            referenceId: tx.referenceId,
                            date: tx.date,
                            status: targetStatus
                        })
                    });
                } else if (!tx.isProjection && tx.id) {
                    return fetch('/api/transactions/status', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: tx.id,
                            status: targetStatus
                        })
                    });
                }
            }));

            // Refresh Data
            // We refresh categories explicitly to ensure coherence
            const promises: Promise<any>[] = [fetchData(true)];
            affectedCategories.forEach(catId => promises.push(fetchCategoryDetails(catId)));
            await Promise.all(promises);

        } catch (error) {
            console.error('Error updating status:', error);
            alert('Error updating status');
            // Revert changes could be implemented here by refetching
            affectedCategories.forEach(catId => fetchCategoryDetails(catId));
        }
    };

    const addPeriod = () => setPeriodsCount((p: number) => Math.min(p + 1, 60));
    const removePeriod = () => setPeriodsCount((p: number) => Math.max(p - 1, 1));
    const handlePeriodsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 1 && val <= 60) {
            setPeriodsCount(val);
        }
    };

    const getRowVariation = (row: RowData) => {
        if (row.cells.length < 2) return { current: row.cells[row.cells.length - 1] || 0, previous: 0 };
        const current = row.cells[row.cells.length - 1];
        const previous = row.cells[row.cells.length - 2];
        return { current, previous };
    };

    // Agrupar transacciones por descripción usando caché local
    const getTransactionGroups = (row: RowData) => {
        const transactions = detailsCache[row.category.id];
        if (!transactions || !data) return [];

        const groups: { [key: string]: { description: string, cells: number[], total: number, cellTxs: any[][] } } = {};

        transactions.forEach(tx => {
            // Encontrar columna correspondiente
            const colIndex = data.columns.findIndex(col =>
                tx.date >= col.startDate && tx.date <= col.endDate
            );

            if (colIndex !== -1) {
                const key = tx.description || 'Sin descripción';
                if (!groups[key]) {
                    groups[key] = {
                        description: tx.description || '',
                        cells: new Array(data.columns.length).fill(0),
                        total: 0,
                        cellTxs: new Array(data.columns.length).fill(null).map(() => [])
                    };
                }
                const amount = Number(tx.amount);
                groups[key].cells[colIndex] += amount;
                groups[key].total += amount;
                groups[key].cellTxs[colIndex].push(tx);
            }
        });

        return Object.values(groups).sort((a, b) => b.total - a.total);
    };

    const getCalculatedRowValues = (row: RowData): { cells: number[], total: number } => {
        const details = detailsCache[row.category.id];
        // Don't recalculate for virtual rows (like Credit Cards) as they don't have standard transactions
        if (details && data && !(row.category as any).isVirtual) {
            const newCells = new Array(data.columns.length).fill(0);
            let newTotal = 0;
            details.forEach(tx => {
                const colIndex = data.columns.findIndex(col => tx.date >= col.startDate && tx.date <= col.endDate);
                if (colIndex !== -1) {
                    const amount = Number(tx.amount);
                    newCells[colIndex] += amount;
                    newTotal += amount;
                }
            });
            return { cells: newCells, total: newTotal };
        }
        return { cells: row.cells.map(Number), total: Number(row.total) };
    };

    // Calcular totales de ingresos y gastos por columna
    const calculatedTotals = useMemo(() => {
        if (!data) return { income: [], expense: [], incomeGrandTotal: 0, expenseGrandTotal: 0 };

        const income = new Array(data.columns.length).fill(0);
        const expense = new Array(data.columns.length).fill(0);
        let incomeGrandTotal = 0;
        let expenseGrandTotal = 0;

        data.incomeRows.forEach(row => {
            const { cells, total } = getCalculatedRowValues(row);
            cells.forEach((val, idx) => {
                income[idx] += val;
            });
            incomeGrandTotal += total;
        });

        data.expenseRows.forEach(row => {
            const { cells, total } = getCalculatedRowValues(row);
            cells.forEach((val, idx) => {
                expense[idx] += val;
            });
            expenseGrandTotal += total;
        });

        return { income, expense, incomeGrandTotal, expenseGrandTotal };
    }, [data, detailsCache]);

    if (!mounted) return null;

    if (loading && !data) return (
        <div className="animate-pulse flex flex-col gap-4">
            <div className="h-12 bg-gray-200 rounded w-1/3"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
        </div>
    );

    if (!data) return (
        <div className="p-8 text-center">
            <div className="text-red-500 font-bold mb-2">Error loading data</div>
            <div className="text-sm text-gray-600 font-mono bg-gray-100 p-2 rounded inline-block max-w-lg overflow-auto">
                {error || 'Unknown error'}
            </div>
            <button
                onClick={() => fetchData(true)}
                className="block mx-auto mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
                Retry
            </button>
        </div>
    );

    const renderStatusIcon = (txs: any[]) => {
        if (!txs || txs.length === 0) return null;
        const allPaid = txs.every((t: any) => t.status === 'PAID');
        return (
            <div
                className={`absolute top-0.5 left-0.5 z-20 cursor-pointer transition-all hover:scale-110 ${allPaid ? 'text-emerald-500 opacity-100' : 'text-gray-300 opacity-0 group-hover/cell:opacity-100 hover:text-gray-500'}`}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleCellStatus(txs);
                }}
                title={allPaid ? "Marcado como Pagado" : "Marcar como Pagado"}
            >
                {allPaid ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                    </svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                )}
            </div>
        );
    };

    const renderCategoryRow = (row: RowData, type: 'INCOME' | 'EXPENSE') => {
        const isExpanded = expandedCategories.has(row.category.id);
        const details = detailsCache[row.category.id];

        // --- Client-Side Aggregation (Corrección de Sumas) ---
        // Si tenemos detalles en caché, forzamos el recálculo desde los hijos para garantizar consistencia absoluta
        let cellsToRender = row.cells;
        let totalToRender = row.total;

        // Don't recalculate for virtual rows
        if (details && !(row.category as any).isVirtual) {
            const newCells = new Array(data.columns.length).fill(0);
            let newTotal = 0;

            details.forEach(tx => {
                const colIndex = data.columns.findIndex(col => tx.date >= col.startDate && tx.date <= col.endDate);
                if (colIndex !== -1) {
                    const amount = Number(tx.amount);
                    newCells[colIndex] += amount;
                    newTotal += amount;
                }
            });
            // Reemplazamos los valores del backend con los calculados en vivo
            cellsToRender = newCells;
            totalToRender = newTotal;
        }

        const { current, previous } = getRowVariation({ ...row, cells: cellsToRender, total: totalToRender });
        const hasTransactions = totalToRender > 0; // Usar el recalcitulado
        const colorClass = type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600';
        const transactionGroups = isExpanded ? getTransactionGroups(row) : [];

        return (
            <Fragment key={row.category.id}>
                <tr className="hover:bg-gray-50 group transition-colors">
                    <td className="sticky left-0 bg-white group-hover:bg-gray-50 z-10 px-2 py-2 text-gray-700 border-r border-gray-200 font-medium relative">
                        <div className="flex items-center gap-1 justify-between">
                            <div className="flex items-center gap-1 overflow-hidden">
                                {hasTransactions ? (
                                    <button
                                        onClick={() => toggleCategory(row.category.id)}
                                        className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded text-xs flex-shrink-0"
                                    >
                                        {isExpanded ? '▼' : '▶'}
                                    </button>
                                ) : (
                                    <span className="w-5 flex-shrink-0"></span>
                                )}
                                <span className="truncate" title={row.category.name}>{row.category.name}</span>
                            </div>

                            {/* Botón Eliminar Categoría (Visible en Hover) */}
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteCategory(row.category.id, row.category.name); }}
                                className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-600 transition-opacity"
                                title="Eliminar categoría"
                            >
                                🗑️
                            </button>
                        </div>
                    </td>
                    {cellsToRender.map((cell, idx) => {
                        if (!visibleColumnIndices.includes(idx)) return null;

                        const cellDetail = row.cellDetails?.[idx];
                        const cellTxs = cellDetail?.transactions || [];
                        const allPaid = cellTxs.length > 0 && cellTxs.every((t: any) => t.status === 'PAID');

                        return (
                            <td
                                key={idx}
                                className={`px-2 py-1 text-right cursor-pointer transition-colors relative group/cell
                                    ${selectedCell?.categoryId === row.category.id && selectedCell?.columnIndex === idx
                                        ? 'bg-blue-100 ring-2 ring-blue-500 z-10'  // Celda seleccionada
                                        : (allPaid ? 'bg-green-50 text-emerald-700 font-medium hover:bg-green-100' : 'hover:bg-blue-50')
                                    }`}
                                onClick={() => handleCellClick(row, idx)}
                                onDoubleClick={() => handleCellDoubleClick(row, idx, cell)}
                                onContextMenu={(e) => {
                                    if (cellTxs.length > 0) {
                                        e.preventDefault();
                                        toggleCellStatus(cellTxs);
                                    }
                                }}
                                title={allPaid ? 'Todo Pagado' : ''}
                            >
                                {renderStatusIcon(cellTxs)}
                                {editingCell?.categoryId === row.category.id && editingCell?.columnIndex === idx && typeof editingCell.detailDescription === 'undefined' ? (
                                    <input
                                        ref={inputRef}
                                        type="number"
                                        value={editingCell.value}
                                        onChange={e => setEditingCell({ ...editingCell, value: e.target.value })}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const val = editingCell.value;
                                                setEditingCell(null);
                                                saveCellValue(row, idx, val);
                                            }
                                            if (e.key === 'Escape') setEditingCell(null);
                                        }}
                                        onBlur={() => {
                                            if (editingCell && editingCell.categoryId === row.category.id && editingCell.columnIndex === idx) {
                                                const val = editingCell.value;
                                                setEditingCell(null);
                                                saveCellValue(row, idx, val);
                                            }
                                        }}
                                        onFocus={e => e.target.select()}
                                        className="w-full text-right p-2 border-2 border-blue-500 rounded-md text-base font-bold text-blue-700 bg-white shadow-lg outline-none z-50 relative"
                                        autoFocus
                                    />
                                ) : (
                                    <span className={`tabular-nums block w-full overflow-hidden text-ellipsis ${cell > 0 ? `${colorClass} font-medium` : 'text-gray-300'}`}>
                                        {cell > 0 ? formatMoney(cell) : '-'}
                                    </span>
                                )}
                            </td>
                        );
                    })}
                    {showVariations && data.columns.length > 1 && (
                        <td className={`px-2 py-1 text-center font-semibold text-sm bg-blue-50/30 border-l-2 border-blue-100 ${getVariationClass(current, previous, type === 'EXPENSE')}`}>
                            {formatVariation(current, previous)}
                        </td>
                    )}
                    <td className={`px-4 py-2 text-right font-medium ${colorClass} bg-gray-50`}>
                        {formatMoney(totalToRender)}
                    </td>
                </tr>
                {/* Filas de detalle expandidas */}
                {/* BLOCK 1: SubRows (e.g. Credit Card Categories) - Purple */}
                {isExpanded && row.subRows && row.subRows.length > 0 && (
                    row.subRows.map((subRow, subIdx) => (
                        <tr key={`${row.category.id}-sub-${subRow.category.id}`} className="bg-purple-50/50">
                            <td className="sticky left-0 bg-purple-50/50 z-10 px-2 py-1 border-r border-purple-200">
                                <div className="flex items-center gap-2 pl-6 text-sm text-gray-600">
                                    <span>↳</span>
                                    <span className="truncate" title={subRow.category.name}>{subRow.category.name}</span>
                                </div>
                            </td>
                            {data.columns.map((_, idx) => {
                                if (!visibleColumnIndices.includes(idx)) return null;
                                const cellValue = subRow.cells[idx] || 0;
                                const cellTxs = subRow.cellDetails?.[idx]?.transactions || [];
                                const allPaid = cellTxs.length > 0 && cellTxs.every((t: any) => t.status === 'PAID');

                                return (
                                    <td key={idx}
                                        className={`px-2 py-1 text-right text-xs border-b border-gray-100 ${allPaid ? 'text-emerald-600 font-medium' : 'text-gray-500'}`}
                                        title={allPaid ? 'Pagado' : ''}
                                    >
                                        {renderStatusIcon(cellTxs)}
                                        {cellValue > 0 ? formatMoney(cellValue) : '-'}
                                    </td>
                                );
                            })}
                            {showVariations && data.columns.length > 1 && <td className="bg-gray-50"></td>}
                            <td className="px-4 py-2 text-right font-medium text-gray-600 bg-gray-50">
                                {formatMoney(subRow.total)}
                            </td>
                        </tr>
                    ))
                )}

                {/* BLOCK 2: Transaction Groups (Standard) - White/Gray */}
                {isExpanded && (!row.subRows || row.subRows.length === 0) && (
                    transactionGroups.map((group, groupIdx) => (
                        <tr key={`${row.category.id}-detail-${groupIdx}`} className="bg-gray-50/50">
                            <td className="sticky left-0 bg-gray-50/50 z-10 px-2 py-1 border-r border-gray-200">
                                <div className="flex items-center gap-1 pl-6 text-xs text-gray-500">
                                    <span className="text-gray-300">└─</span>
                                    {editingGroup?.categoryId === row.category.id && editingGroup?.oldDescription === group.description ? (
                                        <input
                                            type="text"
                                            value={editingGroup.value}
                                            onChange={e => setEditingGroup({ ...editingGroup, value: e.target.value })}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') saveGroupDescription(row.category.id, group.description, editingGroup.value);
                                                if (e.key === 'Escape') setEditingGroup(null);
                                            }}
                                            onBlur={() => saveGroupDescription(row.category.id, group.description, editingGroup.value)}
                                            autoFocus
                                            className="border rounded px-1 w-full"
                                        />
                                    ) : (
                                        <span
                                            className="truncate italic max-w-[150px] cursor-pointer hover:underline hover:text-blue-600"
                                            title={group.description}
                                            onClick={() => setEditingGroup({ categoryId: row.category.id, oldDescription: group.description, value: group.description || '' })}
                                        >
                                            {group.description || 'Sin descripción'}
                                        </span>
                                    )}
                                </div>
                            </td>
                            {data.columns.map((_, idx) => {
                                if (!visibleColumnIndices.includes(idx)) return null;
                                const cellAmount = group.cells[idx] || 0;
                                return (
                                    <td
                                        key={idx}
                                        className={`px-2 py-1 text-right text-xs relative group/cell ${(group.cellTxs?.[idx]?.length > 0 && group.cellTxs[idx].every((t: any) => t.status === 'PAID')) ? 'bg-green-100/60 text-emerald-700 font-medium' : 'hover:bg-gray-100'}`}
                                        onContextMenu={(e) => {
                                            const txs = group.cellTxs?.[idx] || [];
                                            if (txs.length > 0) {
                                                e.preventDefault();
                                                toggleCellStatus(txs);
                                            }
                                        }}
                                    >
                                        {renderStatusIcon(group.cellTxs?.[idx] || [])}

                                        {/* Edit Logic */}
                                        {editingCell?.categoryId === row.category.id && editingCell?.columnIndex === idx && editingCell.detailDescription === group.description ? (
                                            <input
                                                type="number"
                                                value={editingCell.value}
                                                onChange={e => setEditingCell({ ...editingCell, value: e.target.value })}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        const val = editingCell.value;
                                                        const desc = group.description;
                                                        const txId = editingCell.transactionId;

                                                        // Optimistic UI update or loading state could go here
                                                        setEditingCell(null);
                                                        saveCellValue(row, idx, val, desc, txId);
                                                    }
                                                    if (e.key === 'Escape') setEditingCell(null);
                                                }}
                                                onBlur={() => {
                                                    // Only save on blur if value changed? For now consistent with previous behavior
                                                    if (editingCell && editingCell.categoryId === row.category.id && editingCell.columnIndex === idx) {
                                                        const val = editingCell.value;
                                                        const desc = group.description;
                                                        const txId = editingCell.transactionId;

                                                        // Optimistic UI update or loading state could go here
                                                        setEditingCell(null);
                                                        saveCellValue(row, idx, val, desc, txId);
                                                    }
                                                }}
                                                onFocus={e => e.target.select()}
                                                className="w-full text-right p-1 border border-blue-500 rounded text-xs"
                                                autoFocus
                                                onClick={e => e.stopPropagation()}
                                            />
                                        ) : (
                                            <div className="relative w-full h-full flex items-center justify-end">
                                                <span
                                                    className={`tabular-nums block w-full overflow-hidden text-ellipsis cursor-text ${cellAmount > 0 ? 'text-gray-700' : 'text-gray-300'}`}
                                                    onDoubleClick={() => handleSubCellDoubleClick(row.category.id, idx, cellAmount, group.description, group.cellTxs?.[idx]?.[0]?.id)}
                                                >
                                                    {cellAmount > 0 ? formatMoney(cellAmount) : '-'}
                                                </span>

                                                {/* Edit Pencil Icon - Visible on Group Hover - Positioned Right */}
                                                <button
                                                    className="absolute right-0 opacity-0 group-hover/cell:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity p-0.5"
                                                    title="Editar valor"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const txs = group.cellTxs?.[idx] || [];
                                                        const txId = txs.length > 0 ? txs[0].id : undefined;
                                                        console.log('✏️ Edit clicked. TxID:', txId);
                                                        handleSubCellDoubleClick(row.category.id, idx, cellAmount, group.description, txId);
                                                    }}
                                                >
                                                    ✏️
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                );
                            })}
                            {showVariations && data.columns.length > 1 && (
                                <td className="bg-blue-50/20"></td>
                            )}
                            <td className={`px-4 py-1 text-right text-xs ${colorClass} opacity-70 bg-gray-100/50`}>
                                {formatMoney(group.total)}
                            </td>
                        </tr>
                    ))
                )}
                {/* Add new concept row - clean look, shows + only on hover */}
                {
                    isExpanded && (
                        <tr key={`${row.category.id}-new-row`} className="bg-gray-50/20 group/addrow">
                            <td className="sticky left-0 bg-gray-50/20 z-10 px-2 py-1 border-r border-gray-200">
                                <div className="flex items-center gap-1 pl-6">
                                    <span className="text-xs text-gray-300 italic">nuevo...</span>
                                </div>
                            </td>
                            {data.columns.map((col, idx) => {
                                if (!visibleColumnIndices.includes(idx)) return null;

                                return (
                                    <td
                                        key={idx}
                                        className="px-2 py-1 text-center text-xs cursor-pointer hover:bg-blue-100 transition-colors group/cell"
                                        onDoubleClick={async () => {
                                            // Paso 1: Pedir concepto
                                            const description = prompt(`Concepto para ${col.labelMain}:`);
                                            if (description === null) return; // Cancelado

                                            // Paso 2: Pedir monto
                                            const amountStr = prompt(`Monto para "${description.trim() || 'Sin descripción'}":`);
                                            if (amountStr === null) return; // Cancelado

                                            const amount = Number(amountStr.replace(/[^\d.-]/g, ''));
                                            if (isNaN(amount) || amount <= 0) {
                                                alert('Monto inválido. Debe ser un número mayor a 0.');
                                                return;
                                            }

                                            // Guardar directamente
                                            console.log('Saving new subcategory:', { description: description.trim(), amount });
                                            await saveCellValue(row, idx, amount.toString(), description.trim() || null);
                                        }}
                                        title="Doble click para agregar concepto"
                                    >
                                        <span className="text-gray-200 opacity-0 group-hover/cell:opacity-100 transition-opacity">+</span>
                                    </td>
                                );
                            })}
                            {showVariations && data.columns.length > 1 && (
                                <td className="bg-transparent"></td>
                            )}
                            <td className="px-4 py-1 text-right text-xs text-gray-200 bg-gray-50/20">
                            </td>
                        </tr>
                    )
                }
                {/* SubRows logic removed from here as it is handled in Block 1 above */}
            </Fragment >
        );
    };

    return (
        <div className="flex flex-col gap-4 h-full">
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
                {/* Toggle between modes */}
                <div className="flex gap-1 text-sm bg-gray-100 p-1 rounded-md">
                    <button
                        onClick={() => setUseCustomRange(false)}
                        className={`px-3 py-1.5 rounded ${!useCustomRange ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        📅 Períodos
                    </button>
                    <button
                        onClick={() => setUseCustomRange(true)}
                        className={`px-3 py-1.5 rounded ${useCustomRange ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        📆 Rango
                    </button>
                </div>

                <div className="w-px h-8 bg-gray-200"></div>

                {!useCustomRange ? (
                    /* Period-based mode */
                    <>
                        <div className="flex items-center gap-2">
                            <button onClick={handlePrevMonth} className="p-2 hover:bg-gray-100 rounded text-gray-600 font-bold" title="Anterior">&lt;</button>
                            <input
                                type="month"
                                value={format(currentDate, 'yyyy-MM')}
                                onChange={e => {
                                    if (e.target.value) {
                                        const d = new Date(e.target.value);
                                        const dLocal = new Date(d.getUTCFullYear(), d.getUTCMonth(), 1);
                                        setCurrentDate(dLocal);
                                    }
                                }}
                                className="border border-gray-300 rounded px-2 py-1 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <button onClick={handleNextMonth} className="p-2 hover:bg-gray-100 rounded text-gray-600 font-bold" title="Siguiente">&gt;</button>
                            <button onClick={() => setCurrentDate(new Date())} className="text-xs text-blue-600 hover:underline">Hoy</button>
                        </div>

                        <div className="w-px h-8 bg-gray-200"></div>

                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Períodos:</span>
                            <input
                                type="number"
                                value={periodsCount}
                                onChange={handlePeriodsChange}
                                min={1}
                                max={60}
                                className="w-16 border border-gray-300 rounded px-2 py-1 text-center font-semibold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </>
                ) : (
                    /* Custom range mode */
                    <>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Desde:</span>
                            <input
                                type="date"
                                value={customStartDate}
                                onChange={e => setCustomStartDate(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Hasta:</span>
                            <input
                                type="date"
                                value={customEndDate}
                                onChange={e => setCustomEndDate(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-sm font-semibold text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </>
                )}

                <div className="w-px h-8 bg-gray-200"></div>

                <div className="flex gap-1 text-sm bg-gray-100 p-1 rounded-md">
                    {(['month', 'week', 'day'] as const).map(g => (
                        <button
                            key={g}
                            onClick={() => setGranularity(g)}
                            className={`px-3 py-1.5 rounded ${granularity === g ? 'bg-white shadow-sm text-blue-600 font-medium' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            {g === 'month' ? 'Mes' : g === 'week' ? 'Semana' : 'Día'}
                        </button>
                    ))}
                </div>

                <div className="w-px h-8 bg-gray-200"></div>

                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showVariations}
                        onChange={e => setShowVariations(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Variaciones
                </label>

                <div className="w-px h-8 bg-gray-200"></div>

                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={hideEmptyColumns}
                        onChange={e => setHideEmptyColumns(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    Ocultar columnas vacías
                </label>

                <div className="w-px h-8 bg-gray-200"></div>

                <button
                    onClick={() => setBulkModalOpen(true)}
                    className="px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white text-sm font-medium rounded-lg shadow-sm transition-all"
                >
                    ⚙️ Operaciones
                </button>


            </div>

            {/* Info */}
            <div className="text-xs text-gray-500 flex items-center gap-4 flex-shrink-0">
                <span>💡 <strong>Doble click</strong> para ingresar monto</span>
                <span>💡 <strong>Click</strong> para ver detalle</span>
                <span>💡 <strong>▶</strong> para expandir subcategorías</span>
            </div>

            {/* Matrix Table */}
            <div
                className="bg-white rounded-lg border border-gray-200 shadow flex-1 min-h-0"
                style={{
                    overflow: 'scroll',
                    scrollbarWidth: 'auto',
                    scrollbarColor: '#64748b #e2e8f0'
                }}
            >
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 sticky top-0 z-20">
                        <tr>
                            <th className="sticky left-0 bg-gray-50 z-30 px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48 border-r border-gray-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                Concepto
                            </th>
                            {data.columns.map((col, idx) => (
                                <th key={idx} className="px-2 py-2 text-center text-xs font-medium text-gray-500 tracking-wider min-w-[80px]">
                                    {col.labelSub ? (
                                        <div className="flex flex-col items-center">
                                            <span className="text-gray-400 text-[10px] uppercase">{col.labelMain}</span>
                                            <span className="font-semibold text-gray-600">{col.labelSub}</span>
                                        </div>
                                    ) : (
                                        <span className="capitalize font-semibold">{col.labelMain}</span>
                                    )}
                                </th>
                            ))}
                            {showVariations && data.columns.length > 1 && (
                                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[80px] bg-blue-50 border-l-2 border-blue-200">
                                    Variación
                                </th>
                            )}
                            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider font-bold bg-gray-100 min-w-[100px]">
                                Total
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {/* INGRESOS SECTION */}
                        <tr className="bg-emerald-50/50">
                            <td className="sticky left-0 bg-emerald-50/50 z-10 px-4 py-2 font-bold text-emerald-800 border-r border-gray-200 flex justify-between items-center group">
                                <span>📈 INGRESOS</span>
                                <button
                                    onClick={() => handleAddCategory('INCOME')}
                                    className="w-6 h-6 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-full flex items-center justify-center text-sm ml-2 shadow-sm transition-transform hover:scale-110"
                                    title="Agregar Categoría de Ingreso"
                                >
                                    +
                                </button>
                            </td>
                            {data.columns.map((_, i) => <td key={i}></td>)}
                            {showVariations && data.columns.length > 1 && <td className="bg-blue-50/50"></td>}
                            <td></td>
                        </tr>
                        {data.incomeRows.map((row, i) => (
                            <Fragment key={`${row.category.id}-${i}`}>
                                {renderCategoryRow(row, 'INCOME')}
                            </Fragment>
                        ))}
                        <tr className="bg-emerald-100/50 font-bold text-emerald-900">
                            <td className="sticky left-0 bg-emerald-100 z-10 px-4 py-2 border-r border-emerald-200">Total Ingresos</td>
                            {calculatedTotals.income.map((val, i) => (
                                <td key={i} className="px-3 py-2 text-right font-medium">{formatMoney(val)}</td>
                            ))}
                            {showVariations && data.columns.length > 1 && (
                                <td className={`px-2 py-2 text-center font-bold bg-blue-100/50 border-l-2 border-blue-200 ${getVariationClass(
                                    calculatedTotals.income[calculatedTotals.income.length - 1] || 0,
                                    calculatedTotals.income[calculatedTotals.income.length - 2] || 0
                                )}`}>
                                    {formatVariation(
                                        calculatedTotals.income[calculatedTotals.income.length - 1] || 0,
                                        calculatedTotals.income[calculatedTotals.income.length - 2] || 0
                                    )}
                                </td>
                            )}
                            <td className="px-4 py-2 text-right font-bold bg-emerald-100">
                                {formatMoney(calculatedTotals.incomeGrandTotal)}
                            </td>
                        </tr>

                        {/* Separador */}
                        <tr className="h-2 bg-gray-100"><td colSpan={data.columns.length + (showVariations ? 3 : 2)}></td></tr>

                        {/* GASTOS SECTION */}
                        <tr className="bg-rose-50/50">
                            <td className="sticky left-0 bg-rose-50/50 z-10 px-4 py-2 font-bold text-rose-800 border-r border-gray-200 flex justify-between items-center group">
                                <span>📉 GASTOS</span>
                                <button
                                    onClick={() => handleAddCategory('EXPENSE')}
                                    className="w-6 h-6 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-full flex items-center justify-center text-sm ml-2 shadow-sm transition-transform hover:scale-110"
                                    title="Agregar Categoría de Gasto"
                                >
                                    +
                                </button>
                            </td>
                            {data.columns.map((_, i) => <td key={i}></td>)}
                            {showVariations && data.columns.length > 1 && <td className="bg-blue-50/50"></td>}
                            <td></td>
                        </tr>
                        {data.expenseRows.map((row, i) => (
                            <Fragment key={`${row.category.id}-${i}`}>
                                {renderCategoryRow(row, 'EXPENSE')}
                            </Fragment>
                        ))}
                        <tr className="bg-rose-100/50 font-bold text-rose-900">
                            <td className="sticky left-0 bg-rose-100 z-10 px-4 py-2 border-r border-rose-200">Total Gastos</td>
                            {calculatedTotals.expense.map((val, i) => (
                                <td key={i} className="px-3 py-2 text-right font-medium">{formatMoney(val)}</td>
                            ))}
                            {showVariations && data.columns.length > 1 && (
                                <td className={`px-2 py-2 text-center font-bold bg-blue-100/50 border-l-2 border-blue-200 ${getVariationClass(
                                    calculatedTotals.expense[calculatedTotals.expense.length - 1] || 0,
                                    calculatedTotals.expense[calculatedTotals.expense.length - 2] || 0,
                                    true
                                )}`}>
                                    {formatVariation(
                                        calculatedTotals.expense[calculatedTotals.expense.length - 1] || 0,
                                        calculatedTotals.expense[calculatedTotals.expense.length - 2] || 0
                                    )}
                                </td>
                            )}
                            <td className="px-4 py-2 text-right font-bold bg-rose-100">
                                {formatMoney(calculatedTotals.expenseGrandTotal)}
                            </td>
                        </tr>

                        {/* SALDO NETO */}
                        <tr className="bg-gray-900 text-white font-bold text-base sticky bottom-0 z-20">
                            <td className="sticky left-0 bg-gray-900 z-30 px-4 py-3 border-r border-gray-700">💰 SALDO</td>
                            {calculatedTotals.income.map((inc, i) => {
                                const balance = inc - calculatedTotals.expense[i];
                                return (
                                    <td key={i} className={`px-3 py-3 text-right tabular-nums ${balance < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                        {formatMoney(balance)}
                                    </td>
                                );
                            })}
                            {showVariations && data.columns.length > 1 && (() => {
                                const lastIdx = calculatedTotals.income.length - 1;
                                const prevIdx = calculatedTotals.income.length - 2;
                                const lastBalance = (calculatedTotals.income[lastIdx] || 0) - (calculatedTotals.expense[lastIdx] || 0);
                                const prevBalance = (calculatedTotals.income[prevIdx] || 0) - (calculatedTotals.expense[prevIdx] || 0);
                                return (
                                    <td className={`px-2 py-3 text-center font-bold border-l-2 border-gray-700 ${lastBalance >= prevBalance ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {formatVariation(lastBalance, prevBalance)}
                                    </td>
                                );
                            })()}
                            {(() => {
                                const totalBalance = calculatedTotals.incomeGrandTotal - calculatedTotals.expenseGrandTotal;
                                return (
                                    <td className={`px-4 py-3 text-right ${totalBalance >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                        {formatMoney(totalBalance)}
                                    </td>
                                );
                            })()}
                        </tr>

                        {/* SALDO ACUMULADO */}
                        <tr className="bg-gray-800 text-white font-bold text-sm">
                            <td className="sticky left-0 bg-gray-800 z-30 px-4 py-2 border-r border-gray-600">📊 SALDO Acumulado</td>
                            {(() => {
                                let runningTotal = 0;
                                return calculatedTotals.income.map((inc, i) => {
                                    const periodBalance = inc - calculatedTotals.expense[i];
                                    runningTotal += periodBalance;
                                    return (
                                        <td key={i} className={`px-3 py-2 text-right tabular-nums ${runningTotal < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                                            {formatMoney(runningTotal)}
                                        </td>
                                    );
                                });
                            })()}
                            {showVariations && data.columns.length > 1 && (
                                <td className="px-2 py-2 text-center text-gray-400 border-l-2 border-gray-700">
                                    —
                                </td>
                            )}
                            {(() => {
                                const totalBalance = calculatedTotals.incomeGrandTotal - calculatedTotals.expenseGrandTotal;
                                return (
                                    <td className={`px-4 py-2 text-right ${totalBalance >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                        {formatMoney(totalBalance)}
                                    </td>
                                );
                            })()}
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Modal de detalle */}
            {detailModal && (
                <TransactionDetail
                    categoryId={detailModal.categoryId}
                    categoryName={detailModal.categoryName}
                    startDate={detailModal.startDate}
                    endDate={detailModal.endDate}
                    type={detailModal.type}
                    onClose={() => setDetailModal(null)}
                    onUpdate={handleDetailUpdate}
                />
            )}

            {/* Modal de operaciones masivas */}
            <BulkOperationsModal
                isOpen={bulkModalOpen}
                onClose={() => setBulkModalOpen(false)}
                onSuccess={() => {
                    setDetailsCache({});
                    fetchData(expandedCategories.size > 0);
                }}
                categories={[
                    ...(data?.incomeRows.map(r => ({ id: r.category.id, name: r.category.name, type: 'INCOME' as const })) || []),
                    ...(data?.expenseRows.map(r => ({ id: r.category.id, name: r.category.name, type: 'EXPENSE' as const })) || [])
                ]}
                granularity={granularity}
            />
        </div>
    );
}
