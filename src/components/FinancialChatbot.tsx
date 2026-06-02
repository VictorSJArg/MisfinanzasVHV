'use client';

import { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';

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
}

export default function FinancialChatbot() {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: '1',
            type: 'bot',
            content: '¡Hola! 👋 Soy tu asistente financiero en tiempo real. Podés pedirme cargas de gastos o ingresos, consultar tus balances o buscar transacciones directamente por acá.\n\n**Ejemplos**:\n• "Cargá un gasto de 5000 en comida hoy"\n• "Resumen de este mes"\n• "Buscar gastos de luz en mayo"\n\n¿En qué puedo ayudarte hoy?',
            timestamp: new Date(),
        },
    ]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Cargar historial de chat persistente al iniciar
    useEffect(() => {
        const loadHistory = async () => {
            try {
                const res = await fetch('/api/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'history' })
                });
                const data = await res.json();
                if (data.success && Array.isArray(data.chatHistory) && data.chatHistory.length > 0) {
                    const mapped: Message[] = data.chatHistory.map((m: any, idx: number) => ({
                        id: `hist-${idx}`,
                        type: m.role === 'user' ? 'user' : 'bot',
                        content: m.content,
                        timestamp: new Date()
                    }));
                    setMessages(mapped);
                }
            } catch (error) {
                console.error('Error loading chat history:', error);
            }
        };

        loadHistory();
    }, []);

    // Palabras que indican que n8n procesó y guardó una transacción
    const REFRESH_KEYWORDS = ['listo', 'cargué', 'cargue', 'registré', 'registre', 'guardé', 'guarde', 'agregué', 'agregue', 'añadí', 'añadi'];

    const dispatchRefresh = () => {
        window.dispatchEvent(new CustomEvent('financeDataRefresh'));
    };

    // Enviar mensaje al backend
    const handleSendMessage = async (textToSend?: string) => {
        const queryText = textToSend || inputValue;
        if (!queryText.trim()) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content: queryText,
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        if (!textToSend) setInputValue('');
        setIsTyping(true);

        try {
            const response = await fetch('/api/chat/message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: queryText })
            });

            const result = await response.json();

            const botMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'bot',
                content: result.reply,
                timestamp: new Date(),
                buttons: result.requiresConfirmation
                    ? [
                          { label: '✅ Confirmar', action: 'confirm' },
                          { label: '❌ Cancelar', action: 'cancel' }
                      ]
                    : undefined
            };

            setMessages(prev => [...prev, botMessage]);

            // Refrescar si n8n lo indica explícitamente O si el reply contiene palabras de confirmación
            const replyLower = (result.reply || '').toLowerCase();
            const hasConfirmationWord = REFRESH_KEYWORDS.some(kw => replyLower.includes(kw));
            if (result.refreshRequired || hasConfirmationWord) {
                dispatchRefresh();
            }
        } catch (error) {
            console.error('Error in chatbot connection:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'bot',
                content: '❌ Ocurrió un error al procesar tu solicitud. Asegurá que tu conexión esté activa.',
                timestamp: new Date(),
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

    const handleButtonClick = async (action: string) => {
        if (action === 'confirm') {
            await handleSendMessage('si');
            // Siempre refrescar después de confirmar: el agente sí guardó algo
            dispatchRefresh();
        } else if (action === 'cancel') {
            await handleSendMessage('no');
        }
    };


    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 active:scale-95 duration-200"
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
                            <h3 className="font-semibold text-sm">Asistente VHV</h3>
                            <p className="text-xs text-blue-100">En línea</p>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg) => (
                            <div key={msg.id}>
                                <div className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${msg.type === 'user'
                                        ? 'bg-blue-600 text-white rounded-tr-none'
                                        : 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 rounded-tl-none'
                                        }`}>
                                        <p className="text-sm whitespace-pre-line leading-relaxed">{msg.content}</p>
                                        <p className="text-[10px] mt-1 opacity-70 text-right">
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
                                                className="px-4 py-2 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors shadow-sm"
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
                                <div className="bg-gray-100 dark:bg-slate-800 rounded-2xl px-4 py-3 rounded-tl-none">
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
                                placeholder="Escribí tu mensaje..."
                                className="flex-1 px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-sm"
                            />
                            <button
                                onClick={() => handleSendMessage()}
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
