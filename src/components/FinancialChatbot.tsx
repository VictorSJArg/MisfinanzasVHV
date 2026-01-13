'use client';

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface Message {
    id: string;
    type: 'user' | 'bot';
    content: string;
    timestamp: Date;
    buttons?: ActionButton[];
}

interface ActionButton {
    label: string;
    action: string;
    data?: any;
}

interface Intent {
    type: 'summary' | 'category' | 'comparison' | 'cards' | 'trends' | 'search'
    | 'create' | 'edit' | 'delete' | 'confirm' | 'cancel' | 'select' | 'unknown';
    params: {
        category?: string;
        month?: number;
        year?: number;
        startDate?: string;
        endDate?: string;
        months?: number;
        query?: string;
        transactionType?: 'INCOME' | 'EXPENSE';
        // CRUD params
        amount?: number;
        description?: string;
        categoryName?: string;
        transactionId?: string;
        selection?: number;
    };
}

interface ConversationContext {
    lastIntent: string;
    lastQuery: string;
    lastResults: any[];
    awaitingFollowUp: boolean;
    pendingAction?: {
        type: 'create' | 'edit' | 'delete' | 'select';
        data: any;
        step: number;
    };
}

export default function FinancialChatbot() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            type: 'bot',
            content: '¡Hola! 👋 Soy tu asistente financiero. Puedo ayudarte con:\n\n• Resumen de ingresos y gastos\n• Búsqueda de transacciones\n• **Crear, editar y eliminar transacciones** 🆕\n• Análisis por categoría\n• Estado de tarjetas\n• Tendencias y comparaciones\n\n**Ejemplos**:\n• "Crea un gasto de 5000 en comida"\n• "Cambia el gasto de Rawson a 10000"\n• "Análisis de diciembre y enero"\n\n¿En qué puedo ayudarte?',
            timestamp: new Date(),
        },
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [context, setContext] = useState<ConversationContext | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // ============= DATE EXTRACTION =============
    const extractDateParams = (message: string): { startDate?: string; endDate?: string; month?: number; year?: number } => {
        const lowerMessage = message.toLowerCase();
        const now = new Date();
        const params: any = {};

        // Detectar "ayer", "hoy", "mañana"
        if (lowerMessage.includes('ayer')) {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            params.startDate = yesterday.toISOString().split('T')[0];
            params.endDate = yesterday.toISOString().split('T')[0];
            return params;
        }

        if (lowerMessage.includes('hoy')) {
            params.startDate = now.toISOString().split('T')[0];
            params.endDate = now.toISOString().split('T')[0];
            return params;
        }

        if (lowerMessage.includes('mañana') || lowerMessage.includes('manana')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            params.startDate = tomorrow.toISOString().split('T')[0];
            params.endDate = tomorrow.toISOString().split('T')[0];
            return params;
        }

        // Detectar "el DD de MONTH" o "DD/MM"
        const dateMatch = lowerMessage.match(/(?:el\s+)?(\d{1,2})(?:\s+de\s+(\w+)|\s*\/\s*(\d{1,2}))/);
        if (dateMatch) {
            const day = parseInt(dateMatch[1]);
            let month = now.getMonth();
            let year = now.getFullYear();

            if (dateMatch[2]) {
                // Mes en texto
                const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
                const monthIndex = monthNames.findIndex(m => dateMatch[2].includes(m));
                if (monthIndex !== -1) {
                    month = monthIndex;
                }
            } else if (dateMatch[3]) {
                // Mes en número
                month = parseInt(dateMatch[3]) - 1;
            }

            const targetDate = new Date(year, month, day);
            params.startDate = targetDate.toISOString().split('T')[0];
            params.endDate = targetDate.toISOString().split('T')[0];
            return params;
        }

        // Detectar rangos multi-mes: "diciembre y enero", "noviembre a enero"
        const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
        const monthsFound: number[] = [];

        monthNames.forEach((monthName, index) => {
            if (lowerMessage.includes(monthName)) {
                monthsFound.push(index);
            }
        });

        if (monthsFound.length === 2) {
            // Rango entre dos meses
            const [month1, month2] = monthsFound.sort((a, b) => a - b);
            let year1 = now.getFullYear();
            let year2 = now.getFullYear();

            // Si el segundo mes es menor, probablemente cruzó año
            if (month2 < month1) {
                year2 = year1 + 1;
            }

            // Si diciembre está incluido y estamos en enero, ajustar años
            if (month1 === 11 && now.getMonth() === 0) {
                year1 = now.getFullYear() - 1;
            }

            const startDate = new Date(year1, month1, 1);
            const endDate = new Date(year2, month2 + 1, 0);

            params.startDate = startDate.toISOString().split('T')[0];
            params.endDate = endDate.toISOString().split('T')[0];
            return params;
        }

        // Detectar un solo mes
        monthNames.forEach((month, index) => {
            if (lowerMessage.includes(month) && !params.month) {
                params.month = index + 1;
            }
        });

        // Detectar año
        const yearMatch = lowerMessage.match(/202[0-9]/);
        if (yearMatch) {
            params.year = parseInt(yearMatch[0]);
        }

        // Si tiene mes pero no año, usar año actual (o anterior si es diciembre y estamos en enero)
        if (params.month && !params.year) {
            if (params.month === 12 && now.getMonth() === 0) {
                params.year = now.getFullYear() - 1;
            } else {
                params.year = now.getFullYear();
            }
        }

        // "últimos X meses/días"
        const rangeMatch = lowerMessage.match(/últimos?\s+(\d+)\s+(mes|meses|día|días)/);
        if (rangeMatch) {
            const count = parseInt(rangeMatch[1]);
            const unit = rangeMatch[2];

            if (unit.includes('mes')) {
                const startDate = new Date(now);
                startDate.setMonth(startDate.getMonth() - count);
                params.startDate = startDate.toISOString().split('T')[0];
                params.endDate = now.toISOString().split('T')[0];
            } else if (unit.includes('día')) {
                const startDate = new Date(now);
                startDate.setDate(startDate.getDate() - count);
                params.startDate = startDate.toISOString().split('T')[0];
                params.endDate = now.toISOString().split('T')[0];
            }
        }

        return params;
    };

    // ============= QUERY EXTRACTION =============
    const extractQueryText = (message: string): string => {
        const lowerMessage = message.toLowerCase();

        const stopWords = [
            'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
            'de', 'del', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'desde', 'hasta',
            'me', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'le', 'les',
            'que', 'hay', 'cuanto', 'cuál', 'cuáles', 'cuando', 'donde', 'como',
            'gastos', 'gasto', 'gasté', 'gaste', 'pague', 'pagué', 'pagar',
            'compre', 'compré', 'comprar', 'mostrar', 'muestra', 'ver', 'buscar',
            'ingrese', 'ingresé', 'ingresar', 'cobre', 'cobré', 'cobrar',
            'y', 'o', 'pero', 'ni',
            'al', 'a', 'si', 'no', 'es', 'son', 'fue', 'fueron', 'ser',
            'tengo', 'tiene', 'tener', 'hacer', 'hice', 'hizo'
        ];

        const words = lowerMessage
            .replace(/[¿?¡!,.:;]/g, '')
            .split(/\s+/)
            .filter(word =>
                !stopWords.includes(word) &&
                word.length > 2 &&
                !/^\d+$/.test(word)
            );

        return words.join(' ').trim();
    };

    // ============= TRANSACTION PARAMS EXTRACTION =============
    const extractTransactionParams = (message: string): any => {
        const lowerMessage = message.toLowerCase();
        const params: any = {};

        // IMPORTANTE: Extraer fecha PRIMERO para evitar que el número de fecha se confunda con monto
        const dateParams = extractDateParams(message);
        if (dateParams.startDate) {
            params.date = dateParams.startDate;
        }

        // Extraer descripción: texto después de "en"
        const descriptionMatch = message.match(/en\s+([^0-9$\d][^\d]*?)(?:\s+el\s+\d|\s+para\s+el|\s+hoy|\s+ayer|\s+maña|\s+\d+\/|$)/i);
        if (descriptionMatch) {
            const desc = descriptionMatch[1].trim();
            params.description = desc;
            // Si no hay categoryName explícita, usar la descripción como categoría
            params.categoryName = desc;
        }

        // Extraer monto: "de 5000", "$5000", "5000 pesos"
        // MEJORADO: Evitar capturar números que son parte de fechas
        // Buscar pattern de monto explícito primero
        let amountFound = false;

        // Pattern 1: "de 5000" o "$5000" (muy probablemente es monto)
        const explicitAmountMatch = message.match(/(?:de\s+\$?\s*|^\s*\$\s*)(\d+(?:\.\d{3})*(?:,\d{2})?)/);
        if (explicitAmountMatch) {
            const cleanAmount = explicitAmountMatch[1].replace(/\./g, '').replace(',', '.');
            params.amount = parseFloat(cleanAmount);
            amountFound = true;
        }

        // Pattern 2: Si no encontramos monto explícito, buscar número standalone
        // PERO: ignorar si está cerca de palabras de fecha
        if (!amountFound) {
            // Buscar números que NO estén precedidos/seguidos por indicadores de fecha
            const standaloneNumberMatch = message.match(/(?<!\w)(\d{3,})(?!\s*(de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\/|\d{1,2}\/))(?!\w)/i);
            if (standaloneNumberMatch) {
                const cleanAmount = standaloneNumberMatch[1].replace(/\./g, '').replace(',', '.');
                const amount = parseFloat(cleanAmount);
                // Solo aceptar si es >= 100 (montos muy pequeños probablemente son fechas)
                if (amount >= 100) {
                    params.amount = amount;
                }
            }
        }

        // Extraer categoría explícita (sobreescribe la descripción si se menciona)
        const categoryMatch = lowerMessage.match(/categoría\s+([a-záéíóúñ]+)/);
        if (categoryMatch) {
            params.categoryName = categoryMatch[1];
        }

        // Determinar tipo: por defecto EXPENSE, a menos que se mencione ingreso
        const incomeKeywords = ['ingreso', 'ingresé', 'ingrese', 'cobr', 'recib', 'sueldo', 'salario', 'pago'];
        const hasIncomeKeyword = incomeKeywords.some(keyword => lowerMessage.includes(keyword));

        if (hasIncomeKeyword) {
            params.transactionType = 'INCOME';
        } else {
            // Por defecto es gasto si no se especifica lo contrario
            params.transactionType = 'EXPENSE';
        }

        return params;
    };

    // ============= INTENT DETECTION =============
    const detectIntent = (message: string): Intent => {
        const lowerMessage = message.toLowerCase();
        const params: Intent['params'] = {};

        // Si hay acción pendiente y el mensaje es una confirmación simple
        if (context?.pendingAction) {
            if (lowerMessage.match(/^(si|sí|confirmar|ok|dale|adelante)$/)) {
                return { type: 'confirm', params: {} };
            }
            if (lowerMessage.match(/^(no|cancelar|cancel|cancela)$/)) {
                return { type: 'cancel', params: {} };
            }
            // Si es un número (selección)
            if (/^\d+$/.test(lowerMessage.trim())) {
                params.selection = parseInt(lowerMessage.trim());
                return { type: 'select', params };
            }
        }

        // CRUD Intents
        if (lowerMessage.match(/^(crea|crear|registra|registrar|agrega|agregar|anota|anotar)/)) {
            const transactionParams = extractTransactionParams(message);
            return { type: 'create', params: transactionParams };
        }

        if (lowerMessage.match(/(edit|edita|editar|cambia|cambiar|modifica|modificar|actualiza|actualizar)/)) {
            const transactionParams = extractTransactionParams(message);
            const queryText = extractQueryText(message);
            if (queryText) {
                transactionParams.query = queryText;
            }
            return { type: 'edit', params: transactionParams };
        }

        if (lowerMessage.match(/(elimina|eliminar|borra|borrar|quita|quitar)/)) {
            const queryText = extractQueryText(message);
            params.query = queryText;
            const dateParams = extractDateParams(message);
            Object.assign(params, dateParams);
            return { type: 'delete', params };
        }

        // Detectar tipo de transacción
        if (lowerMessage.includes('gaste') || lowerMessage.includes('gasté') || lowerMessage.includes('pague') || lowerMessage.includes('pagué') || lowerMessage.includes('compre') || lowerMessage.includes('compré')) {
            params.transactionType = 'EXPENSE';
        } else if (lowerMessage.includes('ingrese') || lowerMessage.includes('ingresé') || lowerMessage.includes('cobre') || lowerMessage.includes('cobré') || lowerMessage.includes('recibi') || lowerMessage.includes('recibí')) {
            params.transactionType = 'INCOME';
        }

        // Extraer parámetros de fecha
        const dateParams = extractDateParams(message);
        Object.assign(params, dateParams);

        // Detectar categorías
        const categoryKeywords = ['alquiler', 'comida', 'transporte', 'servicios', 'entretenimiento', 'salud', 'educacion', 'ropa', 'otros', 'supermercado'];
        categoryKeywords.forEach(cat => {
            if (lowerMessage.includes(cat)) {
                params.category = cat;
            }
        });

        // Search intent
        const searchKeywords = ['buscar', 'mostrar', 'muestra', 'ver', 'cuando', 'pague', 'pagué', 'compre', 'compré'];
        const hasSearchIntent = searchKeywords.some(keyword => lowerMessage.includes(keyword));
        const queryText = extractQueryText(message);

        if ((hasSearchIntent && queryText.length > 0) || (queryText.length > 3 && !lowerMessage.includes('resumen') && !lowerMessage.includes('total') && !lowerMessage.includes('análisis') && !lowerMessage.includes('analisis'))) {
            params.query = queryText;
            return { type: 'search', params };
        }

        // Analytics intents
        if (lowerMessage.includes('tarjeta') || lowerMessage.includes('tc') || lowerMessage.includes('credito') || lowerMessage.includes('visa') || lowerMessage.includes('mastercard')) {
            return { type: 'cards', params };
        }

        if (lowerMessage.includes('tendencia') || lowerMessage.includes('historico') || lowerMessage.includes('evolucion') || lowerMessage.includes('ultimos')) {
            const monthsMatch = lowerMessage.match(/(\d+)\s*(mes|meses)/);
            if (monthsMatch) {
                params.months = parseInt(monthsMatch[1]);
            } else {
                params.months = 6;
            }
            return { type: 'trends', params };
        }

        if (lowerMessage.includes('compara') || lowerMessage.includes('diferencia') || lowerMessage.includes('vs') || lowerMessage.includes('versus') || lowerMessage.includes('análisis') || lowerMessage.includes('analisis')) {
            return { type: 'comparison', params };
        }

        if (params.category || lowerMessage.includes('categoria') || lowerMessage.includes('gasto de')) {
            return { type: 'category', params };
        }

        if (lowerMessage.includes('resumen') || lowerMessage.includes('total') || lowerMessage.includes('balance')) {
            return { type: 'summary', params };
        }

        return { type: 'unknown', params: {} };
    };

    // ============= CREATE TRANSACTION =============
    const handleCreateTransaction = async (params: any) => {
        // Si hay datos pendientes en el contexto, combinarlos
        if (context?.pendingAction?.type === 'create' && context.pendingAction.step === 1) {
            // El usuario está respondiendo con datos faltantes
            const existingData = context.pendingAction.data;

            // Intentar extraer monto si no lo teníamos
            if (!existingData.amount && params.amount) {
                existingData.amount = params.amount;
            }

            // Intentar extraer fecha si no la teníamos
            if (!existingData.date && params.date) {
                existingData.date = params.date;
            }

            params = existingData;
        }

        // Verificar campos OBLIGATORIOS: monto y fecha
        const missing: string[] = [];
        if (!params.amount) missing.push('monto');
        if (!params.date) missing.push('fecha');

        // Si falta el monto (más crítico), pedirlo primero
        if (!params.amount) {
            setContext({
                lastIntent: 'create',
                lastQuery: '',
                lastResults: [],
                awaitingFollowUp: true,
                pendingAction: {
                    type: 'create',
                    data: params, // Guardar lo que ya tenemos
                    step: 1
                }
            });

            return {
                content: `📝 Voy a crear un ${params.transactionType === 'EXPENSE' ? 'gasto' : 'ingreso'}.\n\n❓ ¿Cuál es el **monto**?\n\nEjemplo: "5000" o "$5000"`,
                buttons: []
            };
        }

        // Si falta la fecha, pedirla
        if (!params.date) {
            setContext({
                lastIntent: 'create',
                lastQuery: '',
                lastResults: [],
                awaitingFollowUp: true,
                pendingAction: {
                    type: 'create',
                    data: params,
                    step: 1
                }
            });

            return {
                content: `📝 Creando ${params.transactionType === 'EXPENSE' ? 'gasto' : 'ingreso'} de $${params.amount.toLocaleString('es-AR')}${params.description ? ` en "${params.description}"` : ''}.\n\n❓ ¿Para qué **fecha**?\n\nEjemplos: "hoy", "ayer", "13 de enero", "13/01"`,
                buttons: []
            };
        }

        // Ya tenemos todos los campos obligatorios
        // Verificar que el tipo esté definido
        if (!params.transactionType) {
            params.transactionType = 'EXPENSE'; // Por defecto gasto
        }

        // Preparar datos finales
        const transactionData = {
            amount: params.amount,
            description: params.description || '',
            type: params.transactionType,
            date: params.date,
            categoryName: params.categoryName || params.description || 'Otros'
        };

        // Pedir confirmación final
        setContext({
            lastIntent: 'create',
            lastQuery: '',
            lastResults: [],
            awaitingFollowUp: true,
            pendingAction: {
                type: 'create',
                data: transactionData,
                step: 2 // Step 2 = listo para ejecutar
            }
        });

        const typeLabel = transactionData.type === 'EXPENSE' ? '💸 Gasto' : '💰 Ingreso';

        return {
            content: `📝 Voy a crear un ${transactionData.type === 'EXPENSE' ? 'gasto' : 'ingreso'} con estos datos:\n\n${typeLabel}: $${transactionData.amount.toLocaleString('es-AR')}\n📁 Categoría: ${transactionData.categoryName}\n📝 Descripción: ${transactionData.description || '(sin descripción)'}\n📅 Fecha: ${format(new Date(transactionData.date), 'dd/MM/yyyy', { locale: es })}\n🔓 Estado: No pagado\n\n💡 **Para editar**: Escribe el campo y valor\nEj: "monto 8000", "categoría Comida", "fecha hoy"\n\n¿Confirmar?`,
            buttons: [
                { label: '✅ Confirmar', action: 'confirm', data: null },
                { label: '❌ Cancelar', action: 'cancel', data: null }
            ]
        };
    };

    const executeCreateTransaction = async (data: any) => {
        try {
            const response = await fetch('/api/chat/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                setContext(null);
                return `✅ ¡Listo! ${data.type === 'EXPENSE' ? 'Gasto' : 'Ingreso'} registrado exitosamente.\n\n📅 ${format(new Date(data.date), 'dd/MM/yyyy', { locale: es })}\n💸 $${data.amount.toLocaleString('es-AR')}\n📁 ${data.categoryName}\n\n✨ Transacción creada.`;
            } else {
                setContext(null);
                return `❌ Error al crear la transacción: ${result.error || 'Error desconocido'}`;
            }
        } catch (error) {
            setContext(null);
            return `❌ Error de conexión al crear la transacción.`;
        }
    };

    // ============= EDIT FIELDS IN CONFIRMATION =============
    const handleEditFields = () => {
        if (!context?.pendingAction?.data) {
            return '❌ No hay datos para editar.';
        }

        const data = context.pendingAction.data;

        setContext({
            ...context,
            pendingAction: {
                type: 'create',
                data: data,
                step: 3 // Step 3 = modo edición
            }
        });

        return {
            content: `✏️ **Modo Edición**\n\nActual:\n💸 Monto: $${data.amount.toLocaleString('es-AR')}\n📁 Categoría: ${data.categoryName}\n📝 Descripción: ${data.description || '(sin descripción)'}\n📅 Fecha: ${format(new Date(data.date), 'dd/MM/yyyy', { locale: es })}\n\n¿Qué campo quieres cambiar?\n\n**Ejemplos**:\n• "monto 8000"\n• "categoría Transporte"\n• "descripción Taxi al aeropuerto"\n• "fecha hoy"\n• "listo" (cuando termines)`,
            buttons: [
                { label: '✅ Listo', action: 'done_editing', data: null },
                { label: '❌ Cancelar', action: 'cancel', data: null }
            ]
        };
    };

    const handleFieldEdit = (message: string) => {
        if (!context?.pendingAction?.data) {
            return '❌ No hay datos para editar.';
        }

        const lowerMessage = message.toLowerCase();
        const data = { ...context.pendingAction.data };

        let fieldUpdated = false;

        // Editar monto
        if (lowerMessage.includes('monto')) {
            const amountMatch = message.match(/(\d+(?:\.\d{3})*(?:,\d{2})?)/);
            if (amountMatch) {
                const cleanAmount = amountMatch[1].replace(/\./g, '').replace(',', '.');
                data.amount = parseFloat(cleanAmount);
                fieldUpdated = true;
            }
        }

        // Editar categoría
        if (lowerMessage.includes('categor')) {
            const categoryMatch = message.match(/categor[íi]a\s+([a-záéíóúñ\s]+)/i);
            if (categoryMatch) {
                data.categoryName = categoryMatch[1].trim();
                fieldUpdated = true;
            }
        }

        // Editar descripción
        if (lowerMessage.includes('descripci')) {
            const descMatch = message.match(/descripci[óo]n\s+(.+)/i);
            if (descMatch) {
                data.description = descMatch[1].trim();
                fieldUpdated = true;
            }
        }

        // Editar fecha
        if (lowerMessage.includes('fecha')) {
            const dateParams = extractDateParams(message);
            if (dateParams.startDate) {
                data.date = dateParams.startDate;
                fieldUpdated = true;
            }
        }

        if (!fieldUpdated) {
            return {
                content: '❌ No entendí el campo a editar. Escribe:\n• "monto 8000"\n• "categoría Transporte"\n• "descripción nueva descripción"\n• "fecha hoy"',
                buttons: [
                    { label: '✅ Confirmar', action: 'confirm', data: null },
                    { label: '❌ Cancelar', action: 'cancel', data: null }
                ]
            };
        }

        // Volver directamente a confirmación (step 2) después de editar
        setContext({
            ...context,
            pendingAction: {
                type: 'create',
                data: data,
                step: 2
            }
        });

        const typeLabel = data.type === 'EXPENSE' ? '💸 Gasto' : '💰 Ingreso';
        return {
            content: `✅ Campo actualizado!\n\n📝 Datos actualizados:\n\n${typeLabel}: $${data.amount.toLocaleString('es-AR')}\n📁 Categoría: ${data.categoryName}\n📝 Descripción: ${data.description || '(sin descripción)'}\n📅 Fecha: ${format(new Date(data.date), 'dd/MM/yyyy', { locale: es })}\n🔓 Estado: No pagado\n\n💡 Puedes seguir editando o confirmar`,
            buttons: [
                { label: '✅ Confirmar', action: 'confirm', data: null },
                { label: '❌ Cancelar', action: 'cancel', data: null }
            ]
        };
    };

    // ============= EDIT TRANSACTION =============
    const handleEditTransaction = async (params: any) => {
        if (!params.query) {
            return '❌ ¿Qué transacción quieres editar? Especifica una descripción o fecha.';
        }

        // Buscar transacciones
        try {
            const queryParams = new URLSearchParams();
            queryParams.set('query', params.query);
            if (params.startDate) queryParams.set('startDate', params.startDate);
            if (params.endDate) queryParams.set('endDate', params.endDate);

            const response = await fetch(`/api/transactions/search?${queryParams.toString()}`);
            const result = await response.json();

            if (!result.success || result.data.length === 0) {
                return `❌ No encontré transacciones con "${params.query}"`;
            }

            const transactions = result.data;

            if (transactions.length === 1) {
                // Solo una, pedir confirmación
                const tx = transactions[0];
                setContext({
                    lastIntent: 'edit',
                    lastQuery: params.query,
                    lastResults: transactions,
                    awaitingFollowUp: true,
                    pendingAction: {
                        type: 'edit',
                        data: { transactionId: tx.id, amount: params.amount, description: params.description },
                        step: 1
                    }
                });

                const changes: string[] = [];
                if (params.amount) changes.push(`💸 Monto: $${tx.amount} → $${params.amount.toLocaleString('es-AR')}`);
                if (params.description) changes.push(`📝 Descripción: "${tx.description}" → "${params.description}"`);

                return {
                    content: `✏️ ¿Confirmar cambio?\n\n📅 ${format(new Date(tx.date), 'dd/MM/yyyy', { locale: es })} - ${tx.description}\n\n${changes.join('\n')}\n\n¿Proceder?`,
                    buttons: [
                        { label: '✅ Sí', action: 'confirm', data: null },
                        { label: '❌ No', action: 'cancel', data: null }
                    ]
                };
            } else {
                // Múltiples, pedir selección
                setContext({
                    lastIntent: 'edit',
                    lastQuery: params.query,
                    lastResults: transactions,
                    awaitingFollowUp: true,
                    pendingAction: {
                        type: 'select',
                        data: { amount: params.amount, description: params.description },
                        step: 1
                    }
                });

                let list = `Encontré ${transactions.length} transacciones con "${params.query}":\n\n`;
                transactions.slice(0, 5).forEach((tx: any, idx: number) => {
                    list += `${idx + 1}️⃣ ${format(new Date(tx.date), 'dd/MM/yyyy', { locale: es })} - ${tx.description} - $${tx.amount.toLocaleString('es-AR')}\n`;
                });
                list += `\nResponde con el número (1-${Math.min(5, transactions.length)}) o "cancelar"`;

                return list;
            }
        } catch (error) {
            return '❌ Error al buscar transacciones.';
        }
    };

    const executeEditTransaction = async (data: any) => {
        try {
            const response = await fetch('/api/chat/edit', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                setContext(null);
                return `✅ Transacción actualizada correctamente.`;
            } else {
                setContext(null);
                return `❌ Error al actualizar: ${result.error || 'Error desconocido'}`;
            }
        } catch (error) {
            setContext(null);
            return '❌ Error de conexión al actualizar.';
        }
    };

    // ============= DELETE TRANSACTION =============
    const handleDeleteTransaction = async (params: any) => {
        if (!params.query && !params.startDate) {
            return '❌ ¿Qué transacción quieres eliminar? Especifica una descripción o fecha.';
        }

        try {
            const queryParams = new URLSearchParams();
            if (params.query) queryParams.set('query', params.query);
            if (params.startDate) queryParams.set('startDate', params.startDate);
            if (params.endDate) queryParams.set('endDate', params.endDate);

            const response = await fetch(`/api/transactions/search?${queryParams.toString()}`);
            const result = await response.json();

            if (!result.success || result.data.length === 0) {
                return `❌ No encontré transacciones para eliminar.`;
            }

            const transactions = result.data;

            if (transactions.length === 1) {
                const tx = transactions[0];
                setContext({
                    lastIntent: 'delete',
                    lastQuery: params.query || '',
                    lastResults: transactions,
                    awaitingFollowUp: true,
                    pendingAction: {
                        type: 'delete',
                        data: { transactionId: tx.id },
                        step: 1
                    }
                });

                return {
                    content: `⚠️ ¿Estás seguro de eliminar esta transacción?\n\n📅 ${format(new Date(tx.date), 'dd/MM/yyyy', { locale: es })}\n📝 ${tx.description}\n💸 $${tx.amount.toLocaleString('es-AR')}\n\n⚠️ Esta acción no se puede deshacer.`,
                    buttons: [
                        { label: '✅ Sí, eliminar', action: 'confirm', data: null },
                        { label: '❌ Cancelar', action: 'cancel', data: null }
                    ]
                };
            } else {
                setContext({
                    lastIntent: 'delete',
                    lastQuery: params.query || '',
                    lastResults: transactions,
                    awaitingFollowUp: true,
                    pendingAction: {
                        type: 'select',
                        data: {},
                        step: 1
                    }
                });

                let list = `Encontré ${transactions.length} transacciones:\n\n`;
                transactions.slice(0, 5).forEach((tx: any, idx: number) => {
                    list += `${idx + 1}️⃣ ${format(new Date(tx.date), 'dd/MM/yyyy', { locale: es })} - ${tx.description} - $${tx.amount.toLocaleString('es-AR')}\n`;
                });
                list += `\n¿Cuál quieres eliminar? Responde con el número o "cancelar"`;

                return list;
            }
        } catch (error) {
            return '❌ Error al buscar transacciones.';
        }
    };

    const executeDeleteTransaction = async (transactionId: string) => {
        try {
            const response = await fetch(`/api/chat/delete?id=${transactionId}&confirm=true`, {
                method: 'DELETE'
            });

            const result = await response.json();

            if (result.success) {
                setContext(null);
                return `✅ Transacción eliminada correctamente.`;
            } else {
                setContext(null);
                return `❌ Error al eliminar: ${result.error || 'Error desconocido'}`;
            }
        } catch (error) {
            setContext(null);
            return '❌ Error de conexión al eliminar.';
        }
    };

    // ============= HANDLE SELECTION =============
    const handleSelection = async (selection: number) => {
        if (!context || !context.lastResults || selection < 1 || selection > context.lastResults.length) {
            setContext(null);
            return '❌ Selección inválida.';
        }

        const selectedTx = context.lastResults[selection - 1];

        if (context.lastIntent === 'edit') {
            const editData = context.pendingAction?.data || {};
            setContext({
                ...context,
                pendingAction: {
                    type: 'edit',
                    data: { transactionId: selectedTx.id, ...editData },
                    step: 2
                }
            });

            const changes: string[] = [];
            if (editData.amount) changes.push(`💸 Monto: $${selectedTx.amount} → $${editData.amount.toLocaleString('es-AR')}`);
            if (editData.description) changes.push(`📝 Descripción: "${selectedTx.description}" → "${editData.description}"`);

            return {
                content: `✏️ ¿Confirmar cambio?\n\n📅 ${format(new Date(selectedTx.date), 'dd/MM/yyyy', { locale: es })} - ${selectedTx.description}\n\n${changes.join('\n')}\n\n¿Proceder?`,
                buttons: [
                    { label: '✅ Sí', action: 'confirm', data: null },
                    { label: '❌ No', action: 'cancel', data: null }
                ]
            };
        } else if (context.lastIntent === 'delete') {
            setContext({
                ...context,
                pendingAction: {
                    type: 'delete',
                    data: { transactionId: selectedTx.id },
                    step: 2
                }
            });

            return {
                content: `⚠️ ¿Estás seguro de eliminar?\n\n📅 ${format(new Date(selectedTx.date), 'dd/MM/yyyy', { locale: es })}\n📝 ${selectedTx.description}\n💸 $${selectedTx.amount.toLocaleString('es-AR')}`,
                buttons: [
                    { label: '✅ Sí, eliminar', action: 'confirm', data: null },
                    { label: '❌ Cancelar', action: 'cancel', data: null }
                ]
            };
        }

        return '❌ Error en el flujo.';
    };

    // ============= BUILD URL (Analytics) =============
    const buildUrl = (intent: Intent): string => {
        const now = new Date();

        if (intent.type === 'search') {
            const queryParams = new URLSearchParams();
            if (intent.params.query) queryParams.set('query', intent.params.query);
            if (intent.params.category) queryParams.set('category', intent.params.category);
            if (intent.params.transactionType) queryParams.set('type', intent.params.transactionType);
            if (intent.params.startDate) queryParams.set('startDate', intent.params.startDate);
            if (intent.params.endDate) queryParams.set('endDate', intent.params.endDate);
            if (intent.params.month && intent.params.year) {
                const startDate = new Date(intent.params.year, intent.params.month - 1, 1);
                const endDate = new Date(intent.params.year, intent.params.month, 0);
                queryParams.set('startDate', startDate.toISOString().split('T')[0]);
                queryParams.set('endDate', endDate.toISOString().split('T')[0]);
            }
            return `/api/transactions/search?${queryParams.toString()}`;
        }

        const queryParams = new URLSearchParams();
        const currentMonth = intent.params.month || (now.getMonth() + 1);
        const currentYear = intent.params.year || now.getFullYear();

        switch (intent.type) {
            case 'summary':
                queryParams.set('type', 'summary');
                queryParams.set('month', currentMonth.toString());
                queryParams.set('year', currentYear.toString());
                break;

            case 'category':
                queryParams.set('type', 'category');
                if (intent.params.category) queryParams.set('category', intent.params.category);
                queryParams.set('month', currentMonth.toString());
                queryParams.set('year', currentYear.toString());
                break;

            case 'cards':
                queryParams.set('type', 'cards');
                break;

            case 'comparison':
                queryParams.set('type', 'comparison');
                if (intent.params.startDate && intent.params.endDate) {
                    queryParams.set('startDate', intent.params.startDate);
                    queryParams.set('endDate', intent.params.endDate);
                } else {
                    const startDate = new Date(currentYear, currentMonth - 1, 1);
                    const endDate = new Date(currentYear, currentMonth, 0);
                    const prevStartDate = new Date(currentYear, currentMonth - 2, 1);
                    queryParams.set('startDate', startDate.toISOString());
                    queryParams.set('endDate', endDate.toISOString());
                    queryParams.set('compareWith', prevStartDate.toISOString());
                }
                break;

            case 'trends':
                queryParams.set('type', 'trends');
                if (intent.params.category) queryParams.set('category', intent.params.category);
                queryParams.set('months', (intent.params.months || 6).toString());
                break;

            default:
                queryParams.set('type', 'summary');
                queryParams.set('month', currentMonth.toString());
                queryParams.set('year', currentYear.toString());
        }

        return `/api/analytics?${queryParams.toString()}`;
    };

    // ============= FORMAT RESPONSES =============
    const formatSearchResponse = (data: any): string => {
        if (!data || data.length === 0) {
            return '🔍 No encontré transacciones con esos criterios.';
        }

        const total = data.reduce((sum: number, tx: any) => sum + Number(tx.amount), 0);
        let response = `🔍 Encontré ${data.length} transacción${data.length > 1 ? 'es' : ''}:\n\n`;

        data.slice(0, 10).forEach((tx: any) => {
            const emoji = tx.type === 'INCOME' ? '💰' : '💸';
            response += `${emoji} ${format(new Date(tx.date), 'dd/MM/yyyy', { locale: es })} - ${tx.description || 'Sin descripción'}\n   $${Number(tx.amount).toLocaleString('es-AR')} (${tx.category || 'Sin categoría'})\n\n`;
        });

        if (data.length > 10) {
            response += `... y ${data.length - 10} más\n\n`;
        }

        response += `💰 **Total**: $${total.toLocaleString('es-AR')}`;

        return response;
    };

    const formatSummaryResponse = (data: any): string => {
        if (!data) return '❌ No hay datos disponibles.';

        return `📊 **Resumen Financiero**\n\n💰 Ingresos: $${Number(data.income || 0).toLocaleString('es-AR')}\n💸 Gastos: $${Number(data.expenses || 0).toLocaleString('es-AR')}\n📈 Balance: $${Number((data.income || 0) - (data.expenses || 0)).toLocaleString('es-AR')}\n\n${data.insights ? `💡 ${data.insights}` : ''}`;
    };

    const formatCategoryResponse = (data: any): string => {
        if (!data || !data.category) return '❌ No hay datos de categoría.';

        return `📁 **${data.category}**\n\n💸 Total: $${Number(data.total || 0).toLocaleString('es-AR')}\n📊 Transacciones: ${data.count || 0}\n\n${data.insights ? `💡 ${data.insights}` : ''}`;
    };

    const formatCardsResponse = (data: any): string => {
        if (!data || !data.cards || data.cards.length === 0) {
            return '💳 No hay tarjetas registradas.';
        }

        let response = '💳 **Estado de Tarjetas**\n\n';
        data.cards.forEach((card: any) => {
            response += `🔹 ${card.name}\n   Saldo: $${Number(card.balance || 0).toLocaleString('es-AR')}\n\n`;
        });

        return response;
    };

    const formatComparisonResponse = (data: any): string => {
        if (!data) return '❌ No hay datos de comparación.';

        return `📊 **Comparación de Períodos**\n\n📅 Período actual:\n💸 Gastos: $${Number(data.current?.expenses || 0).toLocaleString('es-AR')}\n\n📅 Período anterior:\n💸 Gastos: $${Number(data.previous?.expenses || 0).toLocaleString('es-AR')}\n\n📈 Diferencia: ${data.variation || 'N/A'}\n\n${data.insights ? `💡 ${data.insights}` : ''}`;
    };

    const formatTrendsResponse = (data: any): string => {
        if (!data || !data.trends || data.trends.length === 0) {
            return '📈 No hay suficientes datos para mostrar tendencias.';
        }

        let response = '📈 **Tendencias Históricas**\n\n';
        data.trends.slice(0, 6).forEach((trend: any) => {
            response += `📅 ${trend.period}: $${Number(trend.amount || 0).toLocaleString('es-AR')}\n`;
        });

        return response + `\n${data.insights || ''}`;
    };

    const formatResponse = (data: any, intent: Intent): string => {
        if (!data.success) {
            return '❌ Lo siento, hubo un error al procesar tu consulta.';
        }

        const responseData = data.data;

        switch (intent.type) {
            case 'search':
                return formatSearchResponse(responseData);
            case 'summary':
                return formatSummaryResponse(responseData);
            case 'category':
                return formatCategoryResponse(responseData);
            case 'cards':
                return formatCardsResponse(responseData);
            case 'comparison':
                return formatComparisonResponse(responseData);
            case 'trends':
                return formatTrendsResponse(responseData);
            default:
                return '🤔 No pude entender tu consulta. ¿Podrías reformularla?';
        }
    };

    // ============= HANDLE SEND MESSAGE =============
    const handleSendMessage = async () => {
        if (!inputValue.trim()) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content: inputValue,
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsTyping(true);

        try {
            const intent = detectIntent(inputValue);

            let botResponse: string | { content: string; buttons?: ActionButton[] } = '';

            // Si estamos en modo edición (step 3)
            if (context?.pendingAction?.type === 'create' && context.pendingAction.step === 3) {
                botResponse = handleFieldEdit(inputValue);
            }
            // Si estamos en confirmación (step 2) y el usuario escribe algo que parece edición
            else if (context?.pendingAction?.type === 'create' && context.pendingAction.step === 2) {
                const lowerInput = inputValue.toLowerCase();
                // Detectar si está intentando editar un campo
                if (lowerInput.match(/(monto|categor|descripci|fecha)/)) {
                    // Aplicar la edición directamente
                    botResponse = handleFieldEdit(inputValue);
                }
                // Si no es edición, procesar normalmente (confirmar/cancelar)
                else if (intent.type === 'confirm') {
                    botResponse = await executeCreateTransaction(context.pendingAction.data);
                } else if (intent.type === 'cancel') {
                    setContext(null);
                    botResponse = '❌ Acción cancelada.';
                } else {
                    // No entendió, pedir aclaración
                    botResponse = {
                        content: '❓ ¿Quieres confirmar o editar? Escribe:\n• "si" o click ✅ para crear\n• "campo valor" para editar (ej: "monto 8000")\n• "no" para cancelar',
                        buttons: [
                            { label: '✅ Confirmar', action: 'confirm', data: null },
                            { label: '❌ Cancelar', action: 'cancel', data: null }
                        ]
                    };
                }
            }
            // Si estamos esperando respuesta para crear transacción (step 1 = pidiendo datos)
            else if (context?.pendingAction?.type === 'create' && context.pendingAction.step === 1) {
                // El usuario está respondiendo con el dato faltante
                const transactionParams = extractTransactionParams(inputValue);
                botResponse = await handleCreateTransaction(transactionParams);
            }
            // Handle confirmations and cancellations
            else if (intent.type === 'confirm' && context?.pendingAction) {
                // Solo ejecutar si estamos en step 2 (listo para ejecutar)
                if (context.pendingAction.step === 2) {
                    if (context.pendingAction.type === 'create') {
                        botResponse = await executeCreateTransaction(context.pendingAction.data);
                    } else if (context.pendingAction.type === 'edit') {
                        botResponse = await executeEditTransaction(context.pendingAction.data);
                    } else if (context.pendingAction.type === 'delete') {
                        botResponse = await executeDeleteTransaction(context.pendingAction.data.transactionId);
                    }
                }
            } else if (intent.type === 'cancel') {
                setContext(null);
                botResponse = '❌ Acción cancelada.';
            } else if (intent.type === 'select' && intent.params.selection) {
                botResponse = await handleSelection(intent.params.selection);
            } else if (intent.type === 'create') {
                botResponse = await handleCreateTransaction(intent.params);
            } else if (intent.type === 'edit') {
                botResponse = await handleEditTransaction(intent.params);
            } else if (intent.type === 'delete') {
                botResponse = await handleDeleteTransaction(intent.params);
            } else if (intent.type === 'search' || intent.type === 'summary' || intent.type === 'category' || intent.type === 'cards' || intent.type === 'comparison' || intent.type === 'trends') {
                const url = buildUrl(intent);
                const response = await fetch(url);
                const data = await response.json();
                botResponse = formatResponse(data, intent);
            } else {
                botResponse = '🤔 No entendí tu consulta. Intenta:\n• "Crea un gasto de 5000 en comida"\n• "Buscar gastos de Rawson"\n• "Resumen del mes"\n• "Estado de tarjetas"';
            }

            const botMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'bot',
                content: typeof botResponse === 'string' ? botResponse : botResponse.content,
                timestamp: new Date(),
                buttons: typeof botResponse === 'object' ? botResponse.buttons : undefined
            };

            setMessages(prev => [...prev, botMessage]);
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'bot',
                content: '❌ Ocurrió un error al procesar tu solicitud.',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleButtonClick = async (action: string) => {
        if (action === 'confirm') {
            setInputValue('si');
            setTimeout(() => handleSendMessage(), 100);
        } else if (action === 'cancel') {
            setInputValue('no');
            setTimeout(() => handleSendMessage(), 100);
        } else if (action === 'edit_fields') {
            // Mostrar el modo de edición
            const response = handleEditFields();
            const botMessage: Message = {
                id: Date.now().toString(),
                type: 'bot',
                content: typeof response === 'string' ? response : response.content,
                timestamp: new Date(),
                buttons: typeof response === 'object' ? response.buttons : undefined
            };
            setMessages(prev => [...prev, botMessage]);
        } else if (action === 'done_editing') {
            setInputValue('listo');
            setTimeout(() => handleSendMessage(), 100);
        }
    };

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 opacity-0 hover:opacity-100"
            >
                {isOpen ? '✕' : '💬'}
            </button>

            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-24 right-6 z-50 w-96 h-[600px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col border border-gray-200 dark:border-slate-700 transition-colors">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-t-2xl flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                            🤖
                        </div>
                        <div>
                            <h3 className="font-semibold">Asistente Financiero</h3>
                            <p className="text-xs text-blue-100">En línea</p>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg) => (
                            <div key={msg.id}>
                                <div className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.type === 'user'
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200'
                                        }`}>
                                        <p className="text-sm whitespace-pre-line">{msg.content}</p>
                                        <p className="text-xs mt-1 opacity-70">
                                            {format(msg.timestamp, 'HH:mm')}
                                        </p>
                                    </div>
                                </div>
                                {msg.buttons && (
                                    <div className="flex gap-2 mt-2 justify-start ml-2">
                                        {msg.buttons.map((btn, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => handleButtonClick(btn.action)}
                                                className="px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                                            >
                                                {btn.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {isTyping && (
                            <div className="flex justify-start">
                                <div className="bg-gray-100 dark:bg-slate-800 rounded-2xl px-4 py-3">
                                    <div className="flex gap-1">
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-4 border-t border-gray-200 dark:border-slate-700">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                                placeholder="Escribe tu mensaje..."
                                className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200"
                            />
                            <button
                                onClick={handleSendMessage}
                                className="w-10 h-10 bg-blue-600 hover:bg-blue-700 text-white rounded-full flex items-center justify-center transition-colors"
                            >
                                ➤
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
