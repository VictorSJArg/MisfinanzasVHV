'use client';

import { useState, useEffect } from 'react';
import CategoryExpenseChart from './CategoryExpenseChart';
import { ThemeToggle } from './ThemeToggle';

interface DashboardData {
    currentMonth: { label: string; income: number; expense: number; balance: number; executed: number; pending: number; remaining: number };
    previousMonth: { label: string; income: number; expense: number; balance: number };
    monthlyVariation: { income: number; expense: number; balance: number };
    currentWeek: { income: number; expense: number; balance: number };
    previousWeek: { income: number; expense: number; balance: number };
    weeklyVariation: { income: number; expense: number; balance: number };
    allTime: { income: number; expense: number; balance: number };
    topExpenses: { category: string; amount: number }[];
    accounts: { name: string; type: string; balance: number }[];
    monthlyHistory: { label: string; income: number; expense: number; balance: number }[];
    categoryHistory?: any[];
    categoryBreakdown?: { category: string; amount: number; isTC: boolean }[];
}

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function Dashboard() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);

    // State for month selector
    const today = new Date();
    const [selectedYear, setSelectedYear] = useState(today.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1); // 1-indexed

    useEffect(() => {
        fetchData();
    }, [selectedYear, selectedMonth]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/dashboard?year=${selectedYear}&month=${selectedMonth}&_=${Date.now()}`);
            const result = await res.json();
            setData(result);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handlePrevMonth = () => {
        if (selectedMonth === 1) {
            setSelectedMonth(12);
            setSelectedYear(selectedYear - 1);
        } else {
            setSelectedMonth(selectedMonth - 1);
        }
    };

    const handleNextMonth = () => {
        if (selectedMonth === 12) {
            setSelectedMonth(1);
            setSelectedYear(selectedYear + 1);
        } else {
            setSelectedMonth(selectedMonth + 1);
        }
    };

    const formatMoney = (val: number) => {
        return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(val);
    };

    const formatPercent = (val: number) => {
        const sign = val >= 0 ? '+' : '';
        return `${sign}${val.toFixed(1)}%`;
    };

    if (loading && !data) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                {[...Array(8)].map((_, i) => (
                    <div key={i} className="bg-white dark:bg-slate-900 rounded-xl p-6 h-32"></div>
                ))}
            </div>
        );
    }

    if (!data) return <div>Error cargando dashboard</div>;

    const cards = [
        {
            title: 'Ingresos del Mes',
            value: data.currentMonth.income,
            variation: data.monthlyVariation.income,
            color: 'emerald',
            icon: '📈'
        },
        {
            title: 'Gastos del Mes',
            value: data.currentMonth.expense,
            variation: data.monthlyVariation.expense,
            color: 'rose',
            icon: '📉',
            invertVariation: true
        },
        {
            title: 'Balance del Mes',
            value: data.currentMonth.balance,
            variation: data.monthlyVariation.balance,
            color: data.currentMonth.balance >= 0 ? 'blue' : 'rose',
            icon: '💰'
        },
        {
            title: 'Balance Total',
            value: data.allTime.balance,
            color: data.allTime.balance >= 0 ? 'indigo' : 'rose',
            icon: '🏦'
        }
    ];

    return (
        <div className="space-y-6">
            {/* Month Selector */}
            <div className="flex items-center justify-between gap-4 bg-white dark:bg-slate-900 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-slate-800">
                <div className="flex items-center justify-center gap-4 flex-1">
                    <button
                        onClick={handlePrevMonth}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-gray-700 dark:text-slate-300"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div className="text-center min-w-[200px]">
                        <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100">
                            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-slate-400">Período visualizado</p>
                    </div>
                    <button
                        onClick={handleNextMonth}
                        className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors text-gray-700 dark:text-slate-300"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
                <ThemeToggle />
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((card, i) => (
                    <div key={i} className={`bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800 hover:shadow-md transition-shadow`}>
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-2xl">{card.icon}</span>
                            {card.variation !== undefined && (
                                <span className={`text-xs font-semibold px-2 py-1 rounded-full ${(card.invertVariation ? card.variation <= 0 : card.variation >= 0)
                                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                                    : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300'
                                    }`}>
                                    {formatPercent(card.variation)}
                                </span>
                            )}
                        </div>
                        <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">{card.title}</p>
                        <p className={`text-2xl font-bold mt-1 ${card.color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' :
                            card.color === 'rose' ? 'text-rose-600 dark:text-rose-400' :
                                card.color === 'blue' ? 'text-blue-600 dark:text-blue-400' :
                                    'text-indigo-600 dark:text-indigo-400'
                            }`}>
                            {formatMoney(card.value)}
                        </p>
                    </div>
                ))}
            </div>

            {/* Status Breakdown (Ejecutado vs Pendiente) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border-l-4 border-emerald-500">
                    <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Gastos Ejecutados / Pagados</p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatMoney(data.currentMonth.executed)}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Reales + TC Pagadas</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border-l-4 border-amber-500">
                    <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Gastos Pendientes (Proyectados)</p>
                    <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatMoney(data.currentMonth.pending)}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">TC a vencer</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border-l-4 border-blue-500">
                    <p className="text-gray-500 dark:text-slate-400 text-sm font-medium">Saldo Remanente Real</p>
                    <p className={`text-2xl font-bold mt-1 ${data.currentMonth.remaining >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {formatMoney(data.currentMonth.remaining)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Ingresos - Total (Ejec + Pend)</p>
                </div>
            </div>

            {/* Graphic Section */}
            {data.categoryHistory && (
                <CategoryExpenseChart data={data.categoryHistory} />
            )}

            {/* Secondary Stats */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Comparación Mensual */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800">
                    <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>📊</span> Comparación Mensual
                    </h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600 dark:text-slate-400 text-sm">{data.currentMonth.label}</span>
                            <span className={`font-semibold ${data.currentMonth.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {formatMoney(data.currentMonth.balance)}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-600 dark:text-slate-400 text-sm">{data.previousMonth.label}</span>
                            <span className={`font-semibold ${data.previousMonth.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                {formatMoney(data.previousMonth.balance)}
                            </span>
                        </div>
                        <div className="pt-2 border-t border-gray-100 dark:border-slate-800">
                            <div className="flex justify-between items-center">
                                <span className="text-gray-500 dark:text-slate-500 text-sm">Variación</span>
                                <span className={`font-bold ${data.monthlyVariation.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {formatPercent(data.monthlyVariation.balance)}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Comparación Semanal */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800">
                    <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>📅</span> Esta Semana vs Anterior
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-gray-500 dark:text-slate-500 text-xs uppercase">Esta Semana</p>
                            <p className="text-emerald-600 dark:text-emerald-400 font-semibold">{formatMoney(data.currentWeek.income)}</p>
                            <p className="text-rose-600 dark:text-rose-400 font-semibold">{formatMoney(data.currentWeek.expense)}</p>
                        </div>
                        <div>
                            <p className="text-gray-500 dark:text-slate-500 text-xs uppercase">Semana Anterior</p>
                            <p className="text-emerald-600 dark:text-emerald-400 font-semibold">{formatMoney(data.previousWeek.income)}</p>
                            <p className="text-rose-600 dark:text-rose-400 font-semibold">{formatMoney(data.previousWeek.expense)}</p>
                        </div>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800 flex justify-between">
                        <span className="text-gray-500 dark:text-slate-400 text-sm">Var. Gastos</span>
                        <span className={`font-bold ${data.weeklyVariation.expense <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                            {formatPercent(data.weeklyVariation.expense)}
                        </span>
                    </div>
                </div>

                {/* Top Gastos */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800">
                    <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>🏷️</span> Top Gastos del Mes
                    </h3>
                    <div className="space-y-2">
                        {data.topExpenses.length === 0 ? (
                            <p className="text-gray-400 dark:text-slate-500 text-sm">Sin gastos este mes</p>
                        ) : (
                            data.topExpenses.map((item: any, i: number) => (
                                <div key={i} className="flex justify-between items-center">
                                    <span className="text-gray-600 dark:text-slate-400 text-sm truncate flex-1">{item.category}</span>
                                    <span className="text-rose-600 dark:text-rose-400 font-medium ml-2">{formatMoney(item.amount)}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* Historial de 6 meses */}
            <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800 font-bold">
                <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                    <span>📈</span> Historial de 6 Meses
                </h3>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-gray-500 dark:text-slate-500 uppercase text-xs">
                                <th className="text-left py-2">Mes</th>
                                <th className="text-right py-2">Ingresos</th>
                                <th className="text-right py-2">Gastos</th>
                                <th className="text-right py-2">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.monthlyHistory.map((month: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100 dark:border-slate-800">
                                    <td className="py-2 font-medium text-gray-700 dark:text-slate-300 capitalize">{month.label}</td>
                                    <td className="py-2 text-right text-emerald-600 dark:text-emerald-400">{formatMoney(month.income)}</td>
                                    <td className="py-2 text-right text-rose-600 dark:text-rose-400">{formatMoney(month.expense)}</td>
                                    <td className={`py-2 text-right font-semibold ${month.balance >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400'}`}>
                                        {formatMoney(month.balance)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Cuentas */}
            {data.accounts.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800">
                    <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>💳</span> Cuentas
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {data.accounts.map((account: any, i: number) => (
                            <div key={i} className="bg-gray-50 dark:bg-slate-800 rounded-lg p-4">
                                <p className="text-gray-500 dark:text-slate-400 text-sm">{account.name}</p>
                                <p className={`text-xl font-bold ${account.balance >= 0 ? 'text-gray-800 dark:text-slate-100' : 'text-rose-600 dark:text-rose-400'}`}>
                                    {formatMoney(account.balance)}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Desglose por Categorías */}
            {data.categoryBreakdown && data.categoryBreakdown.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-slate-800">
                    <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-4 flex items-center gap-2">
                        <span>📂</span> Gastos por Categoría (Este Mes)
                    </h3>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Sin TC */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-600 dark:text-slate-300 mb-3 flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                                Gastos Directos (sin TC)
                            </h4>
                            <div className="space-y-2">
                                {data.categoryBreakdown.filter((c: any) => !c.isTC).map((cat: any, i: number) => {
                                    const totalDirect = data.categoryBreakdown!.filter((c: any) => !c.isTC).reduce((sum: number, c: any) => sum + c.amount, 0);
                                    const percent = totalDirect > 0 ? (cat.amount / totalDirect) * 100 : 0;
                                    return (
                                        <div key={i} className="flex items-center gap-2">
                                            <span className="text-sm text-gray-600 dark:text-slate-400 w-32 truncate">{cat.category}</span>
                                            <div className="flex-1 h-4 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full"
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                            <span className="text-sm font-medium text-gray-700 dark:text-slate-200 w-24 text-right">{formatMoney(cat.amount)}</span>
                                        </div>
                                    );
                                })}
                                <div className="pt-2 border-t border-gray-100 dark:border-slate-800 mt-2 flex justify-between">
                                    <span className="font-medium text-gray-700 dark:text-slate-300">Total sin TC</span>
                                    <span className="font-bold text-blue-600 dark:text-blue-400">
                                        {formatMoney(data.categoryBreakdown.filter((c: any) => !c.isTC).reduce((sum: number, c: any) => sum + c.amount, 0))}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Con TC */}
                        <div>
                            <h4 className="text-sm font-medium text-gray-600 dark:text-slate-300 mb-3 flex items-center gap-2">
                                <span className="w-3 h-3 rounded-full bg-purple-500"></span>
                                Gastos de Tarjeta de Crédito
                            </h4>
                            <div className="space-y-2">
                                {data.categoryBreakdown.filter((c: any) => c.isTC).map((cat: any, i: number) => {
                                    const totalTC = data.categoryBreakdown!.filter((c: any) => c.isTC).reduce((sum: number, c: any) => sum + c.amount, 0);
                                    const percent = totalTC > 0 ? (cat.amount / totalTC) * 100 : 0;
                                    return (
                                        <div key={i} className="flex items-center gap-2">
                                            <span className="text-sm text-gray-600 dark:text-slate-400 w-32 truncate">{cat.category}</span>
                                            <div className="flex-1 h-4 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full"
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                            <span className="text-sm font-medium text-gray-700 dark:text-slate-200 w-24 text-right">{formatMoney(cat.amount)}</span>
                                        </div>
                                    );
                                })}
                                {data.categoryBreakdown.filter((c: any) => c.isTC).length === 0 && (
                                    <p className="text-gray-400 dark:text-slate-500 text-sm">Sin gastos de TC este mes</p>
                                )}
                                <div className="pt-2 border-t border-gray-100 dark:border-slate-800 mt-2 flex justify-between">
                                    <span className="font-medium text-gray-700 dark:text-slate-300">Total TC</span>
                                    <span className="font-bold text-purple-600 dark:text-purple-400">
                                        {formatMoney(data.categoryBreakdown.filter((c: any) => c.isTC).reduce((sum: number, c: any) => sum + c.amount, 0))}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Total General */}
                    <div className="mt-4 pt-4 border-t-2 border-gray-200 dark:border-slate-800 flex justify-between items-center">
                        <span className="font-semibold text-gray-800 dark:text-slate-100">Total General del Mes</span>
                        <span className="text-xl font-bold text-rose-600 dark:text-rose-400">
                            {formatMoney(data.categoryBreakdown.reduce((sum: number, c: any) => sum + c.amount, 0))}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
