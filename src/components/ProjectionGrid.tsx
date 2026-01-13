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
    { id: 'COMBUSTIBLE', name: '⛽ Combustible', color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400' },
    { id: 'ALIMENTOS', name: '🛒 Alimentos', color: 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-400' },
    { id: 'ENTRETENIMIENTO', name: '🎬 Entretenimiento', color: 'bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-400' },
    { id: 'SERVICIOS', name: '📱 Servicios', color: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-400' },
    { id: 'SEGUROS', name: '🛡️ Seguros', color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-400' },
    { id: 'SALUD', name: '💊 Salud', color: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-400' },
    { id: 'GASTRONOMIA', name: '🍔 Gastronomía', color: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-400' },
    { id: 'ROPA', name: '👕 Ropa', color: 'bg-violet-100 dark:bg-violet-900/30 text-violet-800 dark:text-violet-400' },
    { id: 'TRANSPORTE', name: '🚗 Transporte', color: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300' },
    { id: 'IMPUESTOS', name: '📋 Impuestos', color: 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-300' },
    { id: 'CARGOS', name: '💸 Cargos', color: 'bg-rose-100 dark:bg-rose-900/30 text-rose-800 dark:text-rose-400' },
    { id: 'OTROS', name: '📦 Otros', color: 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-300' }
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
    const [showPercentages, setShowPercentages] = useState(false);

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
                    <h3 className="text-sm font-semibold text-gray-600 dark:text-slate-400 mb-3">📂 Gastos por Categoría</h3>
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
                                        <div className="font-bold mt-1">
                                            {formatMoney(total)}
                                            {total > 0 && (() => {
                                                const grandTotal = statementItems.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
                                                const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
                                                return <span className="text-xs font-normal ml-1 opacity-80">({pct.toFixed(0)}%)</span>;
                                            })()}
                                        </div>
                                        <div className="text-xs opacity-75">{items.length} items</div>
                                    </button>

                                    {isExpanded && items.length > 0 && (
                                        <div className="bg-card border border-border rounded-lg shadow-sm max-h-48 overflow-y-auto">
                                            {items.map(item => (
                                                <div key={item.id} className="px-3 py-2 border-b border-border last:border-0 hover:bg-muted/50">
                                                    <div className="flex justify-between items-center">
                                                        <span className="text-xs text-foreground truncate flex-1">
                                                            {item.description}
                                                        </span>
                                                        <span className="text-xs font-medium text-foreground ml-2">
                                                            {formatMoney(Number(item.amount))}
                                                        </span>
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

            {/* Controls */}
            <div className="flex justify-end px-2">
                <button
                    onClick={() => setShowPercentages(!showPercentages)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${showPercentages ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}
                >
                    {showPercentages ? 'Ocultar %' : 'Mostrar %'}
                </button>
            </div>

            {/* Monthly Projection Grid */}
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                        <thead className="bg-muted sticky top-0 z-20">
                            <tr>
                                <th className="px-3 py-3 text-left text-[10px] font-bold text-muted-foreground uppercase tracking-widest sticky left-0 top-0 bg-muted z-30 border-r border-border min-w-[200px]">
                                    Categoría / Ítem
                                </th>
                                <th className="px-2 py-3 text-right text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-r border-red-100 dark:border-rose-900/30 bg-red-50/50 dark:bg-rose-900/20 w-[100px] sticky top-0">
                                    Actual
                                </th>
                                {showPercentages && (
                                    <th className="px-0 py-0 text-[8px] text-gray-300 dark:text-slate-600 font-normal uppercase vertical-lr tracking-tighter w-4 bg-red-50/10 dark:bg-rose-900/10 border-r border-red-100 dark:border-rose-900/30 sticky top-0">%</th>
                                )}
                                {months.map((month, idx) => (
                                    <Fragment key={idx}>
                                        <th className="px-2 py-3 text-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest min-w-[90px] sticky top-0">
                                            {format(month, 'MMM yy', { locale: es })}
                                        </th>
                                        {showPercentages && (
                                            <th className="px-0 py-0 text-[8px] text-gray-300 dark:text-slate-600 font-normal uppercase vertical-lr tracking-tighter w-4 bg-gray-50/10 dark:bg-slate-800/10 border-r border-gray-100 dark:border-slate-700 sticky top-0">%</th>
                                        )}
                                    </Fragment>
                                ))}
                                <th className="px-3 py-3 text-right text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-widest bg-gray-100 dark:bg-slate-900 border-l border-gray-200 dark:border-slate-800 w-[110px] sticky top-0">
                                    Total
                                </th>
                                {showPercentages && (
                                    <th className="px-0 py-0 text-[8px] text-gray-300 dark:text-slate-600 font-normal uppercase vertical-lr tracking-tighter w-4 bg-gray-100/50 dark:bg-slate-900/50 border-l border-gray-200 dark:border-slate-800 sticky top-0">%</th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {activeCategories.map((category, rowIdx) => {
                                const rowTotal = months.reduce((sum, m) => sum + getCategoryAmount(m, category.id), 0);
                                const isExpanded = expandedCategories.has(category.id);
                                const categoryItems = getCategoryItems(category.id);
                                const currentTotal = categoryItems.reduce((sum, i) => {
                                    if (i.includeInProjection === false) return sum;
                                    return sum + Number(i.amount);
                                }, 0);

                                const uniqueProjectionGrandTotal = activeCategories.reduce((grandSum, cat) => {
                                    return grandSum + months.reduce((mSum, m) => mSum + getCategoryAmount(m, cat.id), 0);
                                }, 0);
                                const percentage = uniqueProjectionGrandTotal > 0 ? (rowTotal / uniqueProjectionGrandTotal) * 100 : 0;

                                return (
                                    <Fragment key={category.id}>
                                        <tr
                                            onClick={() => toggleCategory(category.id)}
                                            className={`border-t border-border transition-colors cursor-pointer group ${rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/30'} ${isExpanded ? 'bg-indigo-50/50 dark:bg-indigo-900/20' : 'hover:bg-muted/50'}`}
                                        >
                                            <td className={`px-3 py-2 sticky left-0 border-r border-border z-10 transition-colors ${rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/40'} ${isExpanded ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'group-hover:bg-muted'}`}>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-muted-foreground text-[10px] w-3">{isExpanded ? '▼' : '▶'}</span>
                                                    <span className={`inline-flex items-center px-2 py-1 rounded-lg text-xs font-medium ${category.color}`}>
                                                        {category.name}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-2 py-2 text-right border-r border-red-100 dark:border-rose-900/30 bg-red-50/30 dark:bg-rose-900/10 font-bold text-foreground text-xs text-nowrap">
                                                {formatMoney(currentTotal)}
                                            </td>
                                            {showPercentages && (
                                                <td className="px-1 py-1 text-right text-[10px] text-gray-500 dark:text-slate-400 bg-red-50/30 dark:bg-rose-900/10 border-r border-red-100 dark:border-rose-900/30">
                                                    {(() => {
                                                        const totalCurrent = statementItems.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
                                                        const pct = totalCurrent > 0 ? (currentTotal / totalCurrent) * 100 : 0;
                                                        return pct > 0 ? `${pct.toFixed(0)}%` : '-';
                                                    })()}
                                                </td>
                                            )}
                                            {months.map((month, colIdx) => {
                                                const amount = getCategoryAmount(month, category.id);
                                                return (
                                                    <Fragment key={colIdx}>
                                                        <td className="px-2 py-2 text-right border-l border-border">
                                                            {amount > 0 ? (
                                                                <span className="text-foreground font-medium text-xs">
                                                                    {formatMoney(amount)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-muted-foreground">-</span>
                                                            )}
                                                        </td>
                                                        {showPercentages && (
                                                            <td className="px-1 py-1 text-right text-[10px] text-gray-400 dark:text-slate-500 bg-gray-50/20 dark:bg-slate-800/20 border-r border-gray-100 dark:border-slate-700">
                                                                {(() => {
                                                                    const colTotal = getMonthTotal(month);
                                                                    const pct = colTotal > 0 ? (amount / colTotal) * 100 : 0;
                                                                    return pct > 0 ? `${pct.toFixed(0)}%` : '-';
                                                                })()}
                                                            </td>
                                                        )}
                                                    </Fragment>
                                                );
                                            })}
                                            <td className="px-3 py-2 text-right font-semibold text-foreground bg-muted border-l border-border text-xs">
                                                {formatMoney(rowTotal)}
                                            </td>
                                            {showPercentages && (
                                                <td className="px-1 py-1 text-right text-[10px] text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-700 border-l border-gray-200 dark:border-slate-600">
                                                    {percentage > 0 ? `${percentage.toFixed(0)}%` : '-'}
                                                </td>
                                            )}
                                        </tr>

                                        {isExpanded && categoryItems.map(item => (
                                            <tr key={item.id} className="bg-card border-b border-border hover:bg-muted/50 group/item transition-colors">
                                                <td className="px-3 py-2 sticky left-0 bg-card z-10 border-r border-border group-hover/item:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-2 pl-4">
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onEditItem?.(item.id, { includeInProjection: !(item.includeInProjection ?? true) });
                                                            }}
                                                            className={`flex-shrink-0 w-4 h-4 flex items-center justify-center rounded border transition-colors ${(item.includeInProjection ?? true)
                                                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                                                : 'bg-card border-border text-transparent hover:border-border'
                                                                }`}
                                                            title={(item.includeInProjection ?? true) ? "Incluido" : "Excluido"}
                                                        >
                                                            {(item.includeInProjection ?? true) && <span className="text-[9px]">✓</span>}
                                                        </button>
                                                        <div className="flex flex-col min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className={`text-xs truncate max-w-[140px] ${(item.includeInProjection ?? true) ? 'text-foreground' : 'text-muted-foreground line-through'}`} title={item.description}>
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
                                                                            className={`w-14 text-right text-[10px] border rounded px-0.5 py-0.5 outline-none focus:border-indigo-500 ${item.projectedAmount ? 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-400 font-medium' : 'border-border text-muted-foreground bg-input'}`}
                                                                        />
                                                                        <select
                                                                            value={item.category || 'OTROS'}
                                                                            onClick={(e) => e.stopPropagation()}
                                                                            onChange={(e) => onEditItem(item.id, { category: e.target.value })}
                                                                            className="w-[80px] text-[9px] border border-gray-200 dark:border-slate-700 rounded px-1 py-0.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
                                                                        >
                                                                            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                                                        </select>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <input
                                                                type="text"
                                                                defaultValue={item.observations || ''}
                                                                key={`obs-${item.id}-${item.observations}`}
                                                                onClick={(e) => e.stopPropagation()}
                                                                onBlur={(e) => {
                                                                    if (e.target.value !== (item.observations || '')) {
                                                                        onEditItem?.(item.id, { observations: e.target.value });
                                                                    }
                                                                }}
                                                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                                                placeholder="Agregar observación..."
                                                                className="flex-1 text-[10px] text-gray-500 dark:text-slate-400 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-slate-600 focus:border-indigo-400 focus:outline-none focus:bg-white dark:focus:bg-slate-800 px-1 py-0.5 mt-1 transition-colors italic"
                                                            />
                                                        </div>
                                                    </div>
                                                </td>
                                                {(() => {
                                                    const isExcluded = item.includeInProjection === false;
                                                    const isEditing = editingCell?.itemId === item.id && editingCell?.yearMonth === 'CURRENT';
                                                    const displayVal = item.amount;
                                                    return (
                                                        <td
                                                            colSpan={showPercentages ? 2 : 1}
                                                            className={`text-right px-2 py-2 text-xs border-r border-red-100 dark:border-rose-900/30 font-medium cursor-pointer transition-colors ${isExcluded ? 'bg-gray-50 dark:bg-slate-800 text-gray-300 dark:text-slate-600' : 'bg-red-50/10 dark:bg-rose-900/5 text-gray-700 dark:text-slate-300 hover:bg-red-50 dark:hover:bg-rose-900/20'}`}
                                                            onDoubleClick={() => !isExcluded && setEditingCell({ itemId: item.id, yearMonth: 'CURRENT', value: displayVal.toString() })}
                                                        >
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editingCell.value}
                                                                    onChange={(e) => setEditingCell({ ...editingCell!, value: e.target.value })}
                                                                    onBlur={async () => {
                                                                        const newVal = parseFloat(editingCell!.value);
                                                                        if (!isNaN(newVal) && newVal !== displayVal) await onEditItem?.(item.id, { amount: newVal });
                                                                        setEditingCell(null);
                                                                    }}
                                                                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                                                    autoFocus
                                                                    className="w-16 text-right bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-600 rounded px-1 py-0.5 text-xs text-gray-800 dark:text-slate-100"
                                                                />
                                                            ) : isExcluded ? '-' : formatMoney(Number(displayVal))}
                                                        </td>
                                                    );
                                                })()}
                                                {months.map((m, idx) => {
                                                    const yearMonth = format(m, 'yyyy-MM');
                                                    const cellKey = `${item.id}-${yearMonth}`;
                                                    const isEditing = editingCell?.itemId === item.id && editingCell?.yearMonth === yearMonth;
                                                    const isSaving = savingCell === cellKey;
                                                    const override = getOverride(item.id, yearMonth);
                                                    let baseVal = 0;
                                                    let hasProjection = false;
                                                    if (item.includeInProjection !== false) {
                                                        if (item.isRecurring) { baseVal = item.projectedAmount ?? item.amount; hasProjection = true; }
                                                        else if (item.installmentCurrent && item.installmentTotal) {
                                                            const remaining = item.installmentTotal - item.installmentCurrent;
                                                            if (idx < remaining) { baseVal = item.projectedAmount ?? item.amount; hasProjection = true; }
                                                        }
                                                    }
                                                    const displayVal = override !== null ? override : baseVal;
                                                    const hasOverride = override !== null && override !== baseVal;
                                                    return (
                                                        <td
                                                            key={idx}
                                                            colSpan={showPercentages ? 2 : 1}
                                                            className={`text-right px-1 py-1 text-xs border-l border-border cursor-pointer hover:bg-yellow-50 dark:hover:bg-yellow-900/20 transition-colors ${hasOverride ? 'bg-yellow-50 dark:bg-yellow-900/30' : ''} ${isSaving ? 'opacity-50' : ''}`}
                                                            onDoubleClick={() => (hasProjection || hasOverride) && setEditingCell({ itemId: item.id, yearMonth, value: displayVal.toString() })}
                                                        >
                                                            {isEditing ? (
                                                                <input
                                                                    type="number"
                                                                    value={editingCell.value}
                                                                    onChange={e => setEditingCell({ ...editingCell!, value: e.target.value })}
                                                                    onBlur={() => {
                                                                        const newAmount = Number(editingCell!.value);
                                                                        if (!isNaN(newAmount) && newAmount >= 0) saveMonthlyOverride(item.id, yearMonth, newAmount);
                                                                        setEditingCell(null);
                                                                    }}
                                                                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingCell(null); }}
                                                                    className="w-16 text-right p-0.5 border border-blue-400 dark:border-blue-600 rounded text-xs bg-input text-foreground"
                                                                    autoFocus
                                                                />
                                                            ) : displayVal > 0 ? (
                                                                <span className={`${hasOverride ? 'text-amber-600 dark:text-amber-400 font-bold' : item.isRecurring ? 'text-green-600 dark:text-emerald-400 font-medium' : 'text-blue-600 dark:text-blue-400'}`}>
                                                                    {formatMoney(displayVal)}
                                                                </span>
                                                            ) : <span className="text-gray-200 dark:text-slate-700 text-[10px]">-</span>}
                                                        </td>
                                                    );
                                                })}
                                                <td colSpan={showPercentages ? 2 : 1} className="bg-muted"></td>
                                            </tr>
                                        ))}
                                    </Fragment>
                                );
                            })}

                            {/* Total Row */}
                            <tr className="bg-gradient-to-r from-rose-50 to-red-50 dark:from-rose-950/40 dark:to-rose-900/40 border-t-2 border-rose-200 dark:border-rose-800 font-bold">
                                <td className="px-3 py-3 text-rose-800 dark:text-rose-300 sticky left-0 z-20 bg-white dark:bg-slate-800 border-r border-rose-200 dark:border-rose-800">
                                    💰 Total Mensual
                                </td>
                                <td className="px-2 py-3 text-right text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border-r border-rose-200 dark:border-rose-800 whitespace-nowrap">
                                    {formatMoney(statementItems.filter(i => i.includeInProjection !== false).reduce((sum, i) => sum + Number(i.amount), 0))}
                                </td>
                                {showPercentages && <td className="bg-rose-50 dark:bg-rose-900/20 border-r border-rose-200 dark:border-rose-800"></td>}
                                {months.map((month, colIdx) => {
                                    const total = getMonthTotal(month);
                                    return (
                                        <Fragment key={colIdx}>
                                            <td className="px-2 py-3 text-right text-rose-700 dark:text-rose-400 border-l border-rose-100 dark:border-rose-900/30">
                                                {total > 0 ? formatMoney(total) : '-'}
                                            </td>
                                            {showPercentages && <td className="border-r border-rose-100 dark:border-rose-900/30"></td>}
                                        </Fragment>
                                    );
                                })}
                                <td className="px-3 py-3 text-right text-rose-800 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border-l border-rose-200 dark:border-rose-800 whitespace-nowrap">
                                    {formatMoney(projections.reduce((sum, p) => sum + p.amount, 0))}
                                </td>
                                {showPercentages && <td className="bg-rose-50 dark:bg-rose-900/20 border-l border-rose-200 dark:border-rose-800"></td>}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

