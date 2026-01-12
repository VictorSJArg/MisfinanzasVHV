'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer
} from 'recharts';
import { Filter, Layers, LayoutGrid, Eye, EyeOff, Check, X, ChevronDown } from 'lucide-react';

interface CategoryExpenseChartProps {
    data: any[];
}

// Updated Vibrant Colors for Dark Background
const COLORS = [
    '#60a5fa', // Blue 400
    '#f87171', // Red 400
    '#34d399', // Emerald 400
    '#fbbf24', // Amber 400
    '#a78bfa', // Violet 400
    '#22d3ee', // Cyan 400
    '#f472b6', // Pink 400
    '#94a3b8', // Slate 400
    '#4ade80', // Green 400
    '#fb7185', // Rose 400
    '#a3e635', // Lime 400
    '#c084fc', // Purple 400
    '#38bdf8', // Sky 400
    '#fb923c', // Orange 400
    '#e879f9'  // Fuchsia 400
];

export default function CategoryExpenseChart({ data }: CategoryExpenseChartProps) {
    const [showTC, setShowTC] = useState(true);
    const [isGrouped, setIsGrouped] = useState(false);
    const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const filterRef = useRef<HTMLDivElement>(null);

    // Close filter dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const processedData = useMemo(() => {
        if (!data || data.length === 0) return [];

        return data.map(monthEntry => {
            const newEntry: any = { month: monthEntry.month, fullLabel: monthEntry.fullLabel };

            Object.keys(monthEntry).forEach(key => {
                if (key === 'month' || key === 'fullLabel' || key === 'monthStart') return;

                const isTC = key.includes(' TC');
                const amount = monthEntry[key];

                if (!showTC && isTC) return;

                let finalKey = key;
                if (isGrouped) {
                    let cleanKey = key.replace(/ TC$/, '');
                    if (isTC) {
                        const parts = cleanKey.split(' ');
                        if (parts.length > 1) {
                            cleanKey = parts.slice(1).join(' ');
                        }
                    }
                    finalKey = cleanKey;
                }

                // Keep 'Ingresos' separate from grouping logic if needed, or if it clashes
                if (key === 'Ingresos') finalKey = 'Ingresos';

                newEntry[finalKey] = (newEntry[finalKey] || 0) + amount;
            });

            return newEntry;
        });
    }, [data, showTC, isGrouped]);

    const categories = useMemo(() => {
        const cats = new Set<string>();
        processedData.forEach(entry => {
            Object.keys(entry).forEach(key => {
                if (key !== 'month' && key !== 'fullLabel') {
                    cats.add(key);
                }
            });
        });
        // Ensure Ingresos is at the top or bottom, sort others
        const list = Array.from(cats).sort();
        if (list.includes('Ingresos')) {
            return ['Ingresos', ...list.filter(c => c !== 'Ingresos')];
        }
        return list;
    }, [processedData]);

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val);
    };

    const toggleCategory = (cat: string) => {
        if (hiddenCategories.includes(cat)) {
            setHiddenCategories(hiddenCategories.filter(c => c !== cat));
        } else {
            setHiddenCategories([...hiddenCategories, cat]);
        }
    };

    const toggleAll = (show: boolean) => {
        if (show) {
            setHiddenCategories([]); // Show all
        } else {
            // Hide all except Ingresos maybe? Or everything.
            setHiddenCategories(categories);
        }
    };

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            // Sort: Hovered category first, then value
            const sortedPayload = [...payload].sort((a, b) => {
                if (a.name === activeCategory) return -1;
                if (b.name === activeCategory) return 1;
                return b.value - a.value;
            });

            return (
                <div className="bg-slate-800/95 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-slate-700 text-sm z-50 min-w-[200px] text-slate-200">
                    <p className="font-bold text-white mb-2 border-b border-slate-600 pb-1">{label}</p>
                    <div className="space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar">
                        {sortedPayload.map((entry: any, index: number) => (
                            <div key={index} className={`flex justify-between items-center gap-4 ${entry.name === activeCategory ? 'bg-slate-700/50 -mx-2 px-2 py-1 rounded' : ''}`}>
                                <div className="flex items-center gap-2 overflow-hidden">
                                    <span className="w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_8px_rgba(0,0,0,0.5)]" style={{ backgroundColor: entry.color }}></span>
                                    <span style={{ color: entry.color }} className={`truncate font-medium filter brightness-110 ${entry.name === activeCategory ? 'font-bold' : ''}`}>
                                        {entry.name}
                                    </span>
                                </div>
                                <span className="font-bold text-white whitespace-nowrap">
                                    {formatMoney(entry.value)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 shadow-xl border border-slate-700/50 space-y-6 transition-all hover:shadow-2xl hover:border-slate-600/50">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/10 rounded-lg text-indigo-400 border border-indigo-500/20">
                        <span className="text-xl">📈</span>
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-white leading-tight">Evolución Financiera</h3>
                        <p className="text-xs text-slate-400 font-medium tracking-wide">INGRESOS VS GASTOS (6 MESES)</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setShowTC(!showTC)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${showTC
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/30 hover:bg-blue-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                            }`}
                    >
                        {showTC ? <Eye size={14} /> : <EyeOff size={14} />}
                        TC
                    </button>

                    <button
                        onClick={() => setIsGrouped(!isGrouped)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${isGrouped
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/30 hover:bg-purple-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'
                            }`}
                    >
                        {isGrouped ? <Layers size={14} /> : <LayoutGrid size={14} />}
                        {isGrouped ? 'Agrupado' : 'Detallado'}
                    </button>

                    <div className="relative" ref={filterRef}>
                        <button
                            onClick={() => setIsFilterOpen(!isFilterOpen)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all border outline-none ${isFilterOpen || hiddenCategories.length > 0
                                ? 'bg-emerald-500 text-white border-emerald-600 shadow-lg shadow-emerald-900/20'
                                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
                                }`}
                        >
                            <Filter size={14} />
                            Filtros
                            {hiddenCategories.length > 0 && (
                                <span className="flex items-center justify-center w-4 h-4 bg-white text-emerald-600 rounded-full text-[9px] font-bold">
                                    {categories.length - hiddenCategories.length}
                                </span>
                            )}
                            <ChevronDown size={12} className={`transition-transform duration-200 ${isFilterOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isFilterOpen && (
                            <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 rounded-xl shadow-2xl border border-slate-600 z-50 p-3 animate-in fade-in slide-in-from-top-2 duration-200 text-white">
                                <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-700">
                                    <span className="text-xs font-bold text-slate-300">Categorías ({categories.length})</span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => toggleAll(true)}
                                            className="text-[10px] text-blue-400 font-medium hover:bg-slate-700 px-2 py-1 rounded transition-colors"
                                        >
                                            Todas
                                        </button>
                                        <button
                                            onClick={() => toggleAll(false)}
                                            className="text-[10px] text-slate-400 font-medium hover:bg-slate-700 px-2 py-1 rounded transition-colors"
                                        >
                                            Ninguna
                                        </button>
                                    </div>
                                </div>
                                <div className="max-h-[300px] overflow-y-auto space-y-1 custom-scroll pr-1">
                                    {categories.map((cat, i) => (
                                        <button
                                            key={cat}
                                            onClick={() => toggleCategory(cat)}
                                            className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors text-left ${!hiddenCategories.includes(cat)
                                                ? 'bg-slate-700 text-white font-medium'
                                                : 'text-slate-500 hover:bg-slate-700/50 hover:text-slate-400'
                                                }`}
                                        >
                                            <span className="flex items-center gap-2 truncate">
                                                <span
                                                    className={`w-2 h-2 rounded-full ${hiddenCategories.includes(cat) ? 'bg-slate-600' : ''}`}
                                                    style={{ backgroundColor: !hiddenCategories.includes(cat) ? (cat === 'Ingresos' ? '#10b981' : COLORS[i % COLORS.length]) : undefined }}
                                                />
                                                <span className="truncate">{cat}</span>
                                            </span>
                                            {!hiddenCategories.includes(cat) && <Check size={12} className="text-emerald-400" />}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="h-[450px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                        data={processedData}
                        margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
                        onMouseMove={(e: any) => {
                            if (e.activePayload) {
                                // Don't set active category based on chart hover generally, rely on line hover
                                // Actually Recharts doesn't easily give "hovered line" in Chart onMouseMove, 
                                // so we use onMouseEnter on Line itself.
                            }
                        }}
                        onMouseLeave={() => setActiveCategory(null)}
                    >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                        <XAxis
                            dataKey="month"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#e2e8f0', fontSize: 12, fontWeight: 500, opacity: 0.8 }}
                            dy={10}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#e2e8f0', fontSize: 11, opacity: 0.8 }}
                            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            width={50}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.2)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                        <Legend content={() => null} />
                        {categories.map((cat, i) => {
                            if (hiddenCategories.includes(cat)) return null;

                            const isIncome = cat === 'Ingresos';
                            const color = isIncome ? '#10b981' : COLORS[i % COLORS.length]; // Emerald 500 for Income

                            // Dimming logic
                            const isDimmed = activeCategory && activeCategory !== cat;
                            const strokeOpacity = isDimmed ? 0.1 : 1;
                            const strokeWidth = isIncome ? 4 : 3;

                            return (
                                <Line
                                    key={cat}
                                    type="monotone"
                                    dataKey={cat}
                                    stroke={color}
                                    strokeWidth={strokeWidth}
                                    strokeOpacity={strokeOpacity}
                                    strokeDasharray={isIncome ? "5 5" : undefined} // Verify preference, usually solid is better for main line, but user asked to distinguish
                                    dot={{ r: isIncome ? 4 : 0, strokeWidth: 0, fill: color, fillOpacity: isDimmed ? 0.1 : 1 }}
                                    activeDot={{ r: 7, fill: color, stroke: '#fff', strokeWidth: 2 }}
                                    animationDuration={1500}
                                    animationEasing="ease-out"
                                    onMouseEnter={() => setActiveCategory(cat)}
                                // onMouseLeave={() => setActiveCategory(null)} // Causes flicker when moving between dots
                                />
                            );
                        })}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-500 border-t border-slate-800 pt-2">
                <span>* Pasa el mouse sobre una línea para enfocarla.</span>
                <span className="text-slate-400">{categories.length - hiddenCategories.length} categorías visibles</span>
            </div>
        </div>
    );
}
