'use client';

import { useState, useEffect, Fragment } from 'react';
import { format, addMonths, startOfMonth } from 'date-fns';
import { es } from 'date-fns/locale';

interface Projection {
    id?: string;
    date: string;
    amount: number;
    description: string;
    type: string;
    cardName: string;
    category?: string;
    source?: 'local' | 'db';
}

interface StatementItem {
    id: string;
    description: string;
    amount: number;
    category: string | null;
    itemType: string;
    isRecurring: boolean;
    includeInProjection?: boolean;
    installmentCurrent?: number | null;
    installmentTotal?: number | null;
    projectedAmount?: number | null;
    observations?: string | null;
}

interface MonthlyOverride {
    itemId: string;
    yearMonth: string;
    amount: number;
}

interface ProjectionGridProps {
    projections: Projection[];
    formatMoney: (val: number) => string;
    showCategoryDetails?: boolean;
    statementItems?: StatementItem[];
    currentStatementDate?: string; // New prop to align timeline
    onEditItem?: (itemId: string, updates: Record<string, any>) => void;
    onDeleteProjection?: (projectionId: string) => void;
    onRefresh?: () => void;
}

const CATEGORIES = [
    { id: 'COMBUSTIBLE', name: '⛽ Combustible', color: 'bg-amber-100 text-amber-800' },
    { id: 'ALIMENTOS', name: '🛒 Alimentos', color: 'bg-orange-100 text-orange-800' },
    { id: 'ENTRETENIMIENTO', name: '🎬 Entretenimiento', color: 'bg-pink-100 text-pink-800' },
    { id: 'SERVICIOS', name: '📱 Servicios', color: 'bg-cyan-100 text-cyan-800' },
    { id: 'SEGUROS', name: '🛡️ Seguros', color: 'bg-indigo-100 text-indigo-800' },
    { id: 'SALUD', name: '💊 Salud', color: 'bg-red-100 text-red-800' },
    { id: 'GASTRONOMIA', name: '🍔 Gastronomía', color: 'bg-yellow-100 text-yellow-800' },
    { id: 'ROPA', name: '👕 Ropa', color: 'bg-violet-100 text-violet-800' },
    { id: 'TRANSPORTE', name: '🚗 Transporte', color: 'bg-slate-100 text-slate-800' },
    { id: 'IMPUESTOS', name: '📋 Impuestos', color: 'bg-gray-100 text-gray-800' },
    { id: 'CARGOS', name: '💸 Cargos', color: 'bg-rose-100 text-rose-800' },
    { id: 'OTROS', name: '📦 Otros', color: 'bg-gray-100 text-gray-800' }
];

export default function ProjectionGrid({
    projections,
    formatMoney,
    showCategoryDetails = false,
    statementItems = [],
    currentStatementDate,
    onEditItem,
    onDeleteProjection,
    onRefresh
}: ProjectionGridProps) {
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
    const [monthlyOverrides, setMonthlyOverrides] = useState<Map<string, number>>(new Map());
    const [editingCell, setEditingCell] = useState<{ itemId: string; yearMonth: string; value: string } | null>(null);
    const [savingCell, setSavingCell] = useState<string | null>(null);

    // Load monthly overrides
    useEffect(() => {
        const loadOverrides = async () => {
            try {
                const res = await fetch('/api/projections/monthly-override');
                const data = await res.json();
                if (data.overrides) {
                    const map = new Map<string, number>();
                    data.overrides.forEach((o: MonthlyOverride) => {
                        map.set(`${o.itemId}-${o.yearMonth}`, Number(o.amount));
                    });
                    setMonthlyOverrides(map);
                }
            } catch (e) {
                console.error('Error loading overrides:', e);
            }
        };
        loadOverrides();
    }, []);

    // Get override for specific item and month
    const getOverride = (itemId: string, yearMonth: string): number | null => {
        const key = `${itemId}-${yearMonth}`;
        return monthlyOverrides.has(key) ? monthlyOverrides.get(key)! : null;
    };

    // Save monthly override
    const saveMonthlyOverride = async (itemId: string, yearMonth: string, amount: number) => {
        setSavingCell(`${itemId}-${yearMonth}`);
        try {
            await fetch('/api/projections/monthly-override', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ itemId, yearMonth, amount })
            });
            // Update local cache
            setMonthlyOverrides(prev => {
                const next = new Map(prev);
                next.set(`${itemId}-${yearMonth}`, amount);
                return next;
            });
            onRefresh?.();
        } catch (e) {
            console.error('Error saving override:', e);
        } finally {
            setSavingCell(null);
        }
    };

    // Generate next 12 months logic
    // If currentStatementDate is present, we start 1 month AFTER it.
    // If not, we start from today.
    const startBase = currentStatementDate ? new Date(currentStatementDate) : new Date();
    // Ensure accurate month stepping by starting from the 1st
    const startDate = startOfMonth(addMonths(startBase, 1));

    const months: Date[] = [];
    for (let i = 0; i < 11; i++) { // Show 11 months ahead (Current + 11 = 12 total columns usually)
        months.push(addMonths(startDate, i));
    }

    // Group projections by category - uses local overrides for real-time updates
    const getCategoryAmount = (month: Date, categoryId: string): number => {
        const monthKey = format(month, 'yyyy-MM');
        const monthIdx = months.findIndex(m => format(m, 'yyyy-MM') === monthKey);

        // CORRECTION: Check if this month is the "Current Statement Month" (startBase)
        const isCurrentMonth = format(month, 'yyyy-MM') === format(startBase, 'yyyy-MM');

        // Get items for this category
        const categoryItems = statementItems.filter(item =>
            item.category === categoryId || (categoryId === 'OTROS' && !item.category)
        );

        // Calculate total from items with override support
        let total = 0;
        for (const item of categoryItems) {
            // Strictly exclude if user unchecked it or set includeInProjection: false
            if (item.includeInProjection === false) continue;

            // Check for monthly override first
            const overrideKey = `${item.id}-${monthKey}`;
            const override = monthlyOverrides.get(overrideKey);

            let baseVal = 0;
            let hasProjection = false;

            if (isCurrentMonth) {
                // If calculate for current month, include EVERYTHING in statement (unless excluded above)
                baseVal = item.amount;
                hasProjection = true;
            } else {
                // Future months logic
                if (item.isRecurring) {
                    baseVal = item.projectedAmount ?? item.amount;
                    hasProjection = true;
                } else if (item.installmentCurrent && item.installmentTotal) {
                    const remaining = item.installmentTotal - item.installmentCurrent;
                    if (monthIdx >= 0 && monthIdx < remaining) {
                        baseVal = item.projectedAmount ?? item.amount;
                        hasProjection = true;
                    }
                }
            }

            if (hasProjection || override !== undefined) {
                total += override !== undefined ? override : Number(baseVal);
            }
        }

        return total;
    };

    // Get category items for details
    const getCategoryItems = (categoryId: string): StatementItem[] => {
        return statementItems.filter(item =>
            item.category === categoryId || (categoryId === 'OTROS' && !item.category)
        );
    };

    // Get total per month - uses getCategoryAmount for consistency with overrides
    const getMonthTotal = (month: Date): number => {
        return CATEGORIES.reduce((sum, cat) => sum + getCategoryAmount(month, cat.id), 0);
    };

    // Check if a category has any data
    const categoryHasData = (categoryId: string): boolean => {
        return months.some(m => getCategoryAmount(m, categoryId) > 0) || getCategoryItems(categoryId).length > 0;
    };

    // Get categories that have data
    const activeCategories = CATEGORIES.filter(cat => categoryHasData(cat.id));

    const toggleCategory = (categoryId: string) => {
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(categoryId)) {
            newExpanded.delete(categoryId);
        } else {
            newExpanded.add(categoryId);
        }
        setExpandedCategories(newExpanded);
    };

    if (projections.length === 0 && statementItems.length === 0) {
        return (
            <div className="text-center py-8 text-gray-500">
                No hay proyecciones. Carga un resumen para ver las proyecciones.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Summary by Category */}
            {showCategoryDetails && statementItems.length > 0 && (
                <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-600 mb-3">📂 Gastos por Categoría (click para expandir)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {activeCategories.map(category => {
                            const items = getCategoryItems(category.id);
                            const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
                            const isExpanded = expandedCategories.has(category.id);

                            return (
                                <div key={category.id} className="space-y-2">
                                    <button
                                        onClick={() => toggleCategory(category.id)}
                                        className={`w-full p-3 rounded-lg ${category.color} text-left transition-all hover:scale-[1.02] hover:shadow-md`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm font-medium">{category.name}</span>
                                            <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
                                        </div>
                                        <div className="font-bold mt-1">{formatMoney(total)}</div>
                                        <div className="text-xs opacity-75">{items.length} items</div>
                                    </button>

                                    {isExpanded && items.length > 0 && (
                                        <div className="bg-white border rounded-lg shadow-sm max-h-48 overflow-y-auto">
                                            {items.map(item => (
                                                <div key={item.id} className="px-3 py-2 border-b last:border-0 hover:bg-gray-50">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs text-gray-700 truncate flex-1">
                                                            {item.description}
                                                        </span>
                                                        <span className="text-xs font-medium text-gray-900 ml-2">
                                                            {formatMoney(Number(item.amount))}
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-2 mt-1">
                                                        {item.isRecurring && <span className="text-[10px] text-green-600">🔄 Recurrente</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Monthly Projection Grid */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
                                <th className="text-left px-3 py-3 font-semibold text-gray-700 sticky left-0 bg-gradient-to-r from-gray-50 to-gray-100 min-w-[220px] border-r border-gray-200">
                                    Categoría
                                </th>
                                <th className="text-center px-2 py-3 font-semibold text-gray-700 min-w-[100px] bg-red-50 border-r border-red-100">
                                    Resumen Actual
                                </th>
                                {months.map((month, idx) => (
                                    <th
                                        key={idx}
                                        className="text-center px-2 py-3 font-medium text-gray-600 min-w-[90px] border-l border-gray-100"
                                    >
                                        <div className="text-xs text-gray-400 uppercase">
                                            {format(month, 'MMM', { locale: es })}
                                        </div>
                                        <div className="text-xs font-semibold">
                                            {format(month, 'yy')}
                                        </div>
                                    </th>
                                ))}
                                <th className="text-center px-3 py-3 font-semibold text-gray-700 min-w-[100px] bg-gray-100 border-l border-gray-300">
                                    Total
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {activeCategories.map((category, rowIdx) => {
                                const rowTotal = months.reduce((sum, m) => sum + getCategoryAmount(m, category.id), 0);
                                const isExpanded = expandedCategories.has(category.id);
                                const categoryItems = getCategoryItems(category.id);
                                // FIX: respect IncludeInProjection for the "Resumen Actual" category total
                                const currentTotal = categoryItems.reduce((sum, i) => {
                                    if (i.includeInProjection === false) return sum;
                                    return sum + Number(i.amount);
                                }, 0);

                                if (rowTotal === 0 && categoryItems.length === 0) return null;

                                return (
                                    <Fragment key={category.id}>
                                        <tr
                                            onClick={() => toggleCategory(category.id)}
                                            className={`border-t border-gray-100 transition-colors cursor-pointer group ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} ${isExpanded ? 'bg-indigo-50/50' : 'hover:bg-gray-50'}`}
                                        >
                                            <td className="px-3 py-2 sticky left-0 border-r border-gray-200 group-hover:bg-gray-50 bg-inherit transition-colors">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-gray-400 text-[10px] w-3">{isExpanded ? '▼' : '▶'}</span>
                                                    <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${category.color}`}>
                                                        {category.name}
                                                    </span>
                                                </div>
                                            </td>
                                            {/* Actual Summary */}
                                            <td className="px-2 py-2 text-right border-r border-red-100 bg-red-50/30 font-bold text-gray-800 text-xs">
                                                {formatMoney(currentTotal)}
                                            </td>
                                            {months.map((month, colIdx) => {
                                                const amount = getCategoryAmount(month, category.id);
                                                return (
                                                    <td
                                                        key={colIdx}
                                                        className="px-2 py-2 text-right border-l border-gray-50"
                                                    >
                                                        {amount > 0 ? (
                                                            <span className="text-gray-700 font-medium text-xs">
                                                                {formatMoney(amount)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-3 py-2 text-right font-semibold text-gray-800 bg-gray-50 border-l border-gray-200 text-xs">
                                                {formatMoney(rowTotal)}
                                            </td>
                                        </tr>

                                        {/* EXPANDED DETAILS ROWS */}
                                        {isExpanded && categoryItems.map(item => (
                                            <tr key={item.id} className="bg-white border-b border-gray-100 hover:bg-gray-50 group/item transition-colors">
                                                {/* Control Column */}
                                                <td className="px-3 py-2 sticky left-0 bg-white group-hover/item:bg-gray-50 border-r border-gray-200 transition-colors">
                                                    <div className="flex items-center gap-2 pl-4">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onEditItem?.(item.id, { includeInProjection: !(item.includeInProjection ?? true) });
                                                            }}
                                                            className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded border transition-colors ${(item.includeInProjection ?? true)
                                                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                                                : 'bg-white border-gray-300 text-transparent hover:border-gray-400'
                                                                }`}
                                                            title={(item.includeInProjection ?? true) ? "Incluido" : "Excluido"}
                                                        >
                                                            {(item.includeInProjection ?? true) && <span className="text-[9px]">✓</span>}
                                                        </button>

                                                        <div className="flex flex-col min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-xs truncate max-w-[140px] ${(item.includeInProjection ?? true) ? 'text-gray-700' : 'text-gray-400 line-through'}`} title={item.description}>
                                                                    {item.description}
                                                                </span>
                                                                {onEditItem && (
                                                                    <div className="flex items-center gap-1">
                                                                        <input
                                                                            type="number"
                                                                            value={item.projectedAmount !== undefined && item.projectedAmount !== null ? item.projectedAmount : item.amount}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => {
                                                                                const val = e.target.value === '' ? null : parseFloat(e.target.value);
                                                                                onEditItem(item.id, { projectedAmount: val });
                                                                            }}
                                                                            className={`w-14 text-right text-[10px] border rounded px-0.5 py-0.5 outline-none focus:border-indigo-500 ${item.projectedAmount ? 'bg-yellow-50 border-yellow-200 text-yellow-800 font-medium' : 'border-gray-200 text-gray-500'}`}
                                                                            title="Proyección manual"
                                                                        />
                                                                        <select
                                                                            value={item.category || 'OTROS'}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => onEditItem(item.id, { category: e.target.value })}
                                                                            className="w-[80px] text-[9px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                                                        >
                                                                            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                                        </select>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <input
                                                                    type="text"
                                                                    defaultValue={item.observations || ''}
                                                                    key={`obs-${item.id}-${item.observations}`} // Key ensures re-render if external data changes
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    onBlur={(e) => {
                                                                        if (e.target.value !== (item.observations || '')) {
                                                                            onEditItem?.(item.id, { observations: e.target.value });
                                                                        }
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            e.currentTarget.blur();
                                                                        }
                                                                    }}
                                                                    placeholder="Agregar observación..."
                                                                    className="flex-1 text-[10px] text-gray-500 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-400 focus:outline-none focus:bg-white px-1 py-0.5 transition-colors placeholder:text-gray-300 italic"
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                {onEditItem && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); onEditItem(item.id, { isRecurring: !item.isRecurring }); }}
                                                                        className={`text-[9px] px-1 py-0 rounded border flex items-center gap-1 transition-colors ${item.isRecurring
                                                                            ? 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
                                                                            : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-100'
                                                                            }`}
                                                                    >
                                                                        {item.isRecurring ? '🔄 Recurrente' : '🛒 Único'}
                                                                    </button>
                                                                )}
                                                                {item.installmentTotal && (
                                                                    <span className="text-[9px] text-blue-600 bg-blue-50 px-1 rounded border border-blue-100">
                                                                        Cuota {item.installmentCurrent}/{item.installmentTotal}
                                                                    </span>
                                                                )}
                                                                <button
                                                                    onClick={async (e) => {
                                                                        e.stopPropagation();
                                                                        if (confirm("¿Quitar este ítem de las proyecciones?")) {
                                                                            await onEditItem?.(item.id, { includeInProjection: false });
                                                                        }
                                                                    }}
                                                                    title="Quitar de proyecciones"
                                                                    className="text-xs w-5 h-5 rounded flex items-center justify-center bg-red-50 text-red-400 hover:bg-red-100 transition-colors ml-auto"
                                                                >
                                                                    🗑️
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Actual Summary */}
                                                {/* Actual Summary - Editable */}
                                                {(() => {
                                                    const isExcluded = item.includeInProjection === false;
                                                    const cellKey = `${item.id}-CURRENT`;
                                                    const isEditing = editingCell?.itemId === item.id && editingCell?.yearMonth === 'CURRENT';
                                                    // For Current Summary, we display (and edit) item.amount directly
                                                    const displayVal = item.amount;

                                                    return (
                                                        <td
                                                            className={`text-center px-2 py-2 text-xs border-r border-red-100 font-medium cursor-pointer transition-colors ${isExcluded ? 'bg-gray-50 text-gray-300' : 'bg-red-50/10 text-gray-700 hover:bg-red-50'}`}
                                                            onDoubleClick={() => {
                                                                if (!isExcluded) {
                                                                    setEditingCell({ itemId: item.id, yearMonth: 'CURRENT', value: displayVal.toString() });
                                                                }
                                                            }}
                                                            title={isExcluded ? 'Excluido' : 'Doble-click para editar monto actual'}
                                                        >
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editingCell.value}
                                                                    onChange={(e) => setEditingCell({ ...editingCell!, value: e.target.value })}
                                                                    onBlur={async () => {
                                                                        const newVal = parseFloat(editingCell.value);
                                                                        if (!isNaN(newVal) && newVal !== displayVal) {
                                                                            // Update ACTUAL AMOUNT
                                                                            await onEditItem?.(item.id, { amount: newVal });
                                                                        }
                                                                        setEditingCell(null);
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            e.currentTarget.blur();
                                                                        }
                                                                    }}
                                                                    autoFocus
                                                                    className="w-16 text-center bg-white border border-indigo-300 rounded px-1 py-0.5 text-xs outline-none shadow-sm"
                                                                />
                                                            ) : (
                                                                isExcluded ? '-' : formatMoney(Number(displayVal))
                                                            )}
                                                        </td>
                                                    );
                                                })()}

                                                {/* Monthly Projections - Editable */}
                                                {months.map((m, idx) => {
                                                    const yearMonth = format(m, 'yyyy-MM');
                                                    const cellKey = `${item.id}-${yearMonth}`;
                                                    const isEditing = editingCell?.itemId === item.id && editingCell?.yearMonth === yearMonth;
                                                    const isSaving = savingCell === cellKey;

                                                    // Check for monthly override first
                                                    const override = getOverride(item.id, yearMonth);

                                                    let baseVal = 0;
                                                    let hasProjection = false;
                                                    if (item.includeInProjection !== false) {
                                                        if (item.isRecurring) {
                                                            baseVal = item.projectedAmount ?? item.amount;
                                                            hasProjection = true;
                                                        } else if (item.installmentCurrent && item.installmentTotal) {
                                                            const remaining = item.installmentTotal - item.installmentCurrent;
                                                            if (idx < remaining) {
                                                                baseVal = item.projectedAmount ?? item.amount;
                                                                hasProjection = true;
                                                            }
                                                        }
                                                    }

                                                    // Use override if exists, otherwise use base value
                                                    const displayVal = override !== null ? override : baseVal;
                                                    const hasOverride = override !== null && override !== baseVal;

                                                    return (
                                                        <td
                                                            key={idx}
                                                            className={`text-center px-1 py-1 text-xs border-l border-gray-50 cursor-pointer hover:bg-yellow-50 transition-colors ${hasOverride ? 'bg-yellow-50' : ''} ${isSaving ? 'opacity-50' : ''}`}
                                                            onDoubleClick={() => {
                                                                if (hasProjection || hasOverride) {
                                                                    setEditingCell({ itemId: item.id, yearMonth, value: displayVal.toString() });
                                                                }
                                                            }}
                                                            title={hasOverride ? 'Valor modificado (doble-click para editar)' : hasProjection ? 'Doble-click para editar' : ''}
                                                        >
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editingCell.value}
                                                                    onChange={e => setEditingCell({ ...editingCell, value: e.target.value })}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') {
                                                                            const newAmount = Number(editingCell.value);
                                                                            if (!isNaN(newAmount) && newAmount >= 0) {
                                                                                saveMonthlyOverride(item.id, yearMonth, newAmount);
                                                                            }
                                                                            setEditingCell(null);
                                                                        }
                                                                        if (e.key === 'Escape') setEditingCell(null);
                                                                    }}
                                                                    onBlur={() => {
                                                                        const newAmount = Number(editingCell.value);
                                                                        if (!isNaN(newAmount) && newAmount >= 0) {
                                                                            saveMonthlyOverride(item.id, yearMonth, newAmount);
                                                                        }
                                                                        setEditingCell(null);
                                                                    }}
                                                                    className="w-full text-center p-0.5 border border-blue-400 rounded text-xs bg-white"
                                                                    autoFocus
                                                                    onClick={e => e.stopPropagation()}
                                                                />
                                                            ) : displayVal > 0 ? (
                                                                <span className={`${hasOverride ? 'text-amber-600 font-bold' : item.isRecurring ? 'text-green-600 font-medium' : 'text-blue-600'}`}>
                                                                    {formatMoney(displayVal)}
                                                                </span>
                                                            ) : <span className="text-gray-200 text-[10px]">-</span>}
                                                        </td>
                                                    );
                                                })}

                                                {/* Total Column Empty */}
                                                <td className="min-w-[100px]"></td>
                                            </tr>
                                        ))}

                                    </Fragment>
                                );
                            })}

                            {/* Total row */}
                            <tr className="bg-gradient-to-r from-rose-50 to-red-50 border-t-2 border-rose-200">
                                <td className="px-3 py-3 font-bold text-rose-800 sticky left-0 bg-gradient-to-r from-rose-50 to-red-50 border-r border-rose-200">
                                    💰 Total Mensual
                                </td>
                                <td className="px-2 py-3 text-right font-bold text-rose-800 bg-rose-100 border-r border-rose-200 text-xs">
                                    {formatMoney(statementItems.filter(i => i.includeInProjection !== false).reduce((sum, i) => sum + Number(i.amount), 0))}
                                </td>
                                {months.map((month, colIdx) => {
                                    const total = getMonthTotal(month);
                                    return (
                                        <td
                                            key={colIdx}
                                            className="px-2 py-3 text-right font-bold text-rose-700 border-l border-rose-100 text-xs"
                                        >
                                            {total > 0 ? formatMoney(total) : '-'}
                                        </td>
                                    );
                                })}
                                <td className="px-3 py-3 text-right font-bold text-rose-800 bg-rose-100 border-l border-rose-200">
                                    {formatMoney(projections.reduce((sum, p) => sum + p.amount, 0))}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div >
        </div >
    );
}
