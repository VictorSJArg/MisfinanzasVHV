import { NextRequest, NextResponse } from 'next/server';

interface ChatRequest {
    message: string;
    intent: string;
    params: {
        category?: string;
        month?: number;
        year?: number;
        startDate?: string;
        endDate?: string;
        compareWith?: string;
        months?: number;
    };
    userId?: string;
}

export async function POST(request: NextRequest) {
    try {
        const body: ChatRequest = await request.json();
        const { message, intent, params } = body;

        // Validar autenticación (opcional pero recomendado)
        const authHeader = request.headers.get('authorization');
        const expectedToken = process.env.N8N_WEBHOOK_SECRET;

        if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
            return NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Construir query a /api/analytics basado en la intención
        const analyticsUrl = buildAnalyticsUrl(intent, params);

        // Llamar al endpoint de analytics
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const fullUrl = `${baseUrl}${analyticsUrl}`;

        const analyticsResponse = await fetch(fullUrl);
        const data = await analyticsResponse.json();

        if (!data.success) {
            return NextResponse.json({
                success: false,
                error: data.error,
                response: {
                    type: 'text',
                    content: 'Lo siento, hubo un error al procesar tu consulta. ' + (data.error || ''),
                },
            });
        }

        // Formatear respuesta para el usuario
        const formattedResponse = formatResponse(data, intent);

        return NextResponse.json({
            success: true,
            response: {
                type: 'text',
                content: formattedResponse,
                data: data.data,
            },
            metadata: {
                originalMessage: message,
                intent,
                timestamp: new Date().toISOString(),
            },
        });
    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json(
            {
                success: false,
                error: 'Internal server error',
                response: {
                    type: 'text',
                    content: 'Lo siento, hubo un error al procesar tu consulta. Por favor intenta de nuevo.',
                },
            },
            { status: 500 }
        );
    }
}

function buildAnalyticsUrl(intent: string, params: any): string {
    const queryParams = new URLSearchParams();

    switch (intent) {
        case 'summary':
        case 'resumen':
            queryParams.set('type', 'summary');
            if (params.month) queryParams.set('month', params.month.toString());
            if (params.year) queryParams.set('year', params.year.toString());
            break;

        case 'category':
        case 'categoria':
        case 'category_expense':
            queryParams.set('type', 'category');
            if (params.category) queryParams.set('category', params.category);
            if (params.month) queryParams.set('month', params.month.toString());
            if (params.year) queryParams.set('year', params.year.toString());
            break;

        case 'cards':
        case 'tarjetas':
        case 'cards_status':
            queryParams.set('type', 'cards');
            break;

        case 'comparison':
        case 'comparacion':
            queryParams.set('type', 'comparison');
            if (params.startDate) queryParams.set('startDate', params.startDate);
            if (params.endDate) queryParams.set('endDate', params.endDate);
            if (params.compareWith) queryParams.set('compareWith', params.compareWith);
            break;

        case 'trends':
        case 'tendencias':
            queryParams.set('type', 'trends');
            if (params.category) queryParams.set('category', params.category);
            if (params.months) queryParams.set('months', params.months.toString());
            break;

        default:
            queryParams.set('type', 'summary');
    }

    return `/api/analytics?${queryParams.toString()}`;
}

function formatResponse(data: any, intent: string): string {
    if (!data.success) {
        return 'Lo siento, hubo un error al procesar tu consulta.';
    }

    switch (intent) {
        case 'summary':
        case 'resumen':
            return formatSummaryResponse(data.data);

        case 'category':
        case 'categoria':
        case 'category_expense':
            return formatCategoryResponse(data.data);

        case 'cards':
        case 'tarjetas':
        case 'cards_status':
            return formatCardsResponse(data.data);

        case 'comparison':
        case 'comparacion':
            return formatComparisonResponse(data.data);

        case 'trends':
        case 'tendencias':
            return formatTrendsResponse(data.data);

        default:
            return JSON.stringify(data.data, null, 2);
    }
}

function formatSummaryResponse(data: any): string {
    const { summary, comparison, insights } = data;

    let response = `📊 **Resumen Financiero - ${summary.period}**\n\n`;
    response += `💰 **Ingresos:** $${summary.income.toLocaleString('es-AR')}\n`;
    response += `💸 **Gastos:** $${summary.expense.toLocaleString('es-AR')}\n`;
    response += `📈 **Balance:** $${summary.balance.toLocaleString('es-AR')}\n\n`;

    if (comparison) {
        response += `📊 **Comparación con mes anterior:**\n`;

        if (comparison.percentageChange.expense !== 0) {
            const expenseChange = comparison.percentageChange.expense;
            const expenseSymbol = expenseChange > 0 ? '📈' : '📉';
            const expenseText = expenseChange > 0 ? 'aumentaron' : 'disminuyeron';
            response += `${expenseSymbol} Gastos ${expenseText} ${Math.abs(expenseChange).toFixed(1)}%\n`;
        }

        if (comparison.percentageChange.income !== 0) {
            const incomeChange = comparison.percentageChange.income;
            const incomeSymbol = incomeChange > 0 ? '📈' : '📉';
            const incomeText = incomeChange > 0 ? 'aumentaron' : 'disminuyeron';
            response += `${incomeSymbol} Ingresos ${incomeText} ${Math.abs(incomeChange).toFixed(1)}%\n`;
        }
        response += '\n';
    }

    if (insights && insights.length > 0) {
        response += `💡 **Insights:**\n`;
        insights.forEach((insight: string) => {
            response += `• ${insight}\n`;
        });
    }

    return response;
}

function formatCategoryResponse(data: any): string {
    const { category, total, transactionCount, transactions, comparison } = data;

    let response = `📋 **Categoría: ${category}**\n\n`;
    response += `💰 **Total:** $${total.toLocaleString('es-AR')}\n`;
    response += `🔢 **Transacciones:** ${transactionCount}\n\n`;

    if (comparison) {
        const change = comparison.percentageChange;
        if (change !== 0) {
            const symbol = change > 0 ? '📈' : '📉';
            const text = change > 0 ? 'aumento' : 'reducción';
            response += `${symbol} ${text} de ${Math.abs(change).toFixed(1)}% vs mes anterior\n\n`;
        }
    }

    if (transactions && transactions.length > 0) {
        response += `📝 **Últimas transacciones:**\n`;
        transactions.slice(0, 5).forEach((t: any) => {
            response += `• ${t.date} - $${t.amount.toLocaleString('es-AR')}`;
            if (t.description) response += ` (${t.description})`;
            response += '\n';
        });
    }

    return response;
}

function formatCardsResponse(data: any): string {
    const { cards, totalBalance, period } = data;

    if (!cards || cards.length === 0) {
        return '💳 No se encontraron tarjetas de crédito con movimientos activos.';
    }

    let response = `💳 **Estado de Tarjetas de Crédito - ${period}**\n\n`;

    cards.forEach((card: any) => {
        response += `🔹 **${card.cardName}**\n`;
        response += `   Consumos: $${card.balance.toLocaleString('es-AR')}`;
        if (card.transactionCount > 0) {
            response += ` (${card.transactionCount} transacciones)`;
        }
        response += '\n\n';
    });

    response += `💰 **Total:** $${totalBalance.toLocaleString('es-AR')}`;

    return response;
}

function formatComparisonResponse(data: any): string {
    const { current, comparison } = data;

    let response = `📊 **Comparación de Períodos**\n\n`;
    response += `📅 **Período Actual:** ${current.period}\n`;
    response += `💰 Ingresos: $${current.income.toLocaleString('es-AR')}\n`;
    response += `💸 Gastos: $${current.expense.toLocaleString('es-AR')}\n`;
    response += `📈 Balance: $${current.balance.toLocaleString('es-AR')}\n\n`;

    if (comparison) {
        response += `📅 **Período Anterior:**\n`;
        response += `💰 Ingresos: $${comparison.income.toLocaleString('es-AR')}\n`;
        response += `💸 Gastos: $${comparison.expense.toLocaleString('es-AR')}\n`;
        response += `📈 Balance: $${comparison.balance.toLocaleString('es-AR')}\n\n`;

        response += `📊 **Diferencias:**\n`;

        if (comparison.percentageChange.income !== 0) {
            const symbol = comparison.percentageChange.income > 0 ? '📈' : '📉';
            response += `${symbol} Ingresos: ${comparison.percentageChange.income > 0 ? '+' : ''}${comparison.percentageChange.income.toFixed(1)}%\n`;
        }

        if (comparison.percentageChange.expense !== 0) {
            const symbol = comparison.percentageChange.expense > 0 ? '📈' : '📉';
            response += `${symbol} Gastos: ${comparison.percentageChange.expense > 0 ? '+' : ''}${comparison.percentageChange.expense.toFixed(1)}%\n`;
        }
    }

    return response;
}

function formatTrendsResponse(data: any): string {
    const { category, trends, average } = data;

    let response = `📈 **Tendencias - ${category}**\n\n`;

    if (trends && trends.length > 0) {
        response += `📊 **Histórico:**\n`;
        trends.forEach((trend: any) => {
            const balanceSymbol = trend.balance >= 0 ? '✅' : '❌';
            response += `${trend.month}: `;
            response += `💰 $${trend.income.toLocaleString('es-AR')} `;
            response += `💸 $${trend.expense.toLocaleString('es-AR')} `;
            response += `${balanceSymbol} $${trend.balance.toLocaleString('es-AR')}\n`;
        });
        response += '\n';
    }

    if (average) {
        response += `📊 **Promedios:**\n`;
        response += `💰 Ingresos promedio: $${average.income.toLocaleString('es-AR')}\n`;
        response += `💸 Gastos promedio: $${average.expense.toLocaleString('es-AR')}\n`;
    }

    return response;
}
