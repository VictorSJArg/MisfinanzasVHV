import { useState, useRef, useEffect } from 'react';
import { parseBancoSanJuanEmail, ParsedEmailTransaction } from '@/utils/parsers/bancoSanJuanParser';
import Tesseract from 'tesseract.js';

interface EmailImportModalProps {
    onClose: () => void;
    onImport: (data: ParsedEmailTransaction, manualStatementDate?: string) => Promise<void>;
}

export default function EmailImportModal({ onClose, onImport }: EmailImportModalProps) {
    const [text, setText] = useState('');
    const [parsed, setParsed] = useState<ParsedEmailTransaction | null>(null);
    const [loading, setLoading] = useState(false);
    const [isReadingImage, setIsReadingImage] = useState(false);
    const [ocrProgress, setOcrProgress] = useState(0);
    const [error, setError] = useState('');
    const [targetStatementDate, setTargetStatementDate] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleParse = () => {
        setError('');
        const result = parseBancoSanJuanEmail(text);
        if (result) {
            setParsed(result);

            // Calculate default target statement date
            if (result.date) {
                const dateObj = new Date(result.date + 'T12:00:00');
                const day = dateObj.getDate();
                let targetMonth = dateObj;

                if (day >= 21) {
                    const nextMonth = new Date(targetMonth);
                    nextMonth.setMonth(nextMonth.getMonth() + 1);
                    targetMonth = nextMonth;
                }

                const year = targetMonth.getFullYear();
                const month = targetMonth.getMonth();
                const lastDay = new Date(year, month + 1, 0).getDate();
                const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

                setTargetStatementDate(targetDateStr);
            }
        } else {
            setError('No se pudo detectar el formato del e-mail. Verifica que hayas copiado el texto completo.');
        }
    };

    const handleConfirm = async () => {
        if (!parsed) return;
        setLoading(true);
        try {
            // Pass the manually selected date along with the parsed data
            await onImport(parsed, targetStatementDate);
            onClose();
        } catch (e: any) {
            setError(e.message || 'Error al importar');
        } finally {
            setLoading(false);
        }
    };

    const processImage = async (file: File) => {
        setIsReadingImage(true);
        setOcrProgress(0);
        setError('');

        try {
            const result = await Tesseract.recognize(
                file,
                'spa',
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            setOcrProgress(Math.round(m.progress * 100));
                        }
                    }
                }
            );

            const extractedText = result.data.text;
            setText(prev => {
                const newText = prev + '\n\n' + extractedText;
                return newText.trim();
            });

        } catch (err) {
            console.error(err);
            setError('Error al leer la imagen.');
        } finally {
            setIsReadingImage(false);
            setOcrProgress(0);
        }
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (file) {
                    await processImage(file);
                }
                return; // Stop after finding an image
            }
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            await processImage(e.target.files[0]);
        }
    };

    // Auto-parse when text changes if it looks like a valid email, 
    // but maybe better to let user click "Analizar" to avoid jarring updates
    // or we can just let them edit the text found by OCR.

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden transform transition-all">
                <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-4">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        📧 Importar desde Email
                    </h3>
                    <p className="text-blue-100 text-xs mt-1">
                        Pega el texto del correo o una captura de pantalla (Ctrl+V)
                    </p>
                </div>

                <div className="p-6">
                    {!parsed ? (
                        <>
                            <div className="mb-4 relative">
                                <textarea
                                    value={text}
                                    onChange={e => setText(e.target.value)}
                                    onPaste={handlePaste}
                                    placeholder="Pega aquí el texto del correo o presiona Ctrl+V para pegar una imagen..."
                                    className="w-full h-48 border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono bg-gray-50"
                                />
                                {isReadingImage && (
                                    <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center rounded-lg backdrop-blur-sm">
                                        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mb-2"></div>
                                        <p className="text-sm font-medium text-blue-700">Leyendo imagen... {ocrProgress}%</p>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 flex items-center gap-2">
                                    ⚠️ {error}
                                </div>
                            )}

                            <div className="flex justify-between items-center">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
                                >
                                    📷 Subir Imagen
                                </button>

                                <div className="flex gap-3">
                                    <button
                                        onClick={onClose}
                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium text-sm"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        onClick={handleParse}
                                        disabled={!text.trim() || isReadingImage}
                                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                    >
                                        Analizar Texto
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="space-y-4">
                            <div className="bg-green-50 border border-green-100 rounded-lg p-4">
                                <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                                    ✅ Datos Detectados
                                </h4>
                                <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm">
                                    <div>
                                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Fecha</p>
                                        <input
                                            type="date"
                                            value={parsed.date}
                                            onChange={e => {
                                                const newDate = e.target.value;
                                                setParsed({ ...parsed, date: newDate });
                                                // Recalculate target statement when date changes
                                                if (newDate) {
                                                    const dateObj = new Date(newDate + 'T12:00:00'); // Midday to avoid timezone shifts
                                                    const day = dateObj.getDate();
                                                    let targetMonth = dateObj;

                                                    // Logic: If day >= 21, it belongs to NEXT month
                                                    if (day >= 21) {
                                                        const nextMonth = new Date(targetMonth);
                                                        nextMonth.setMonth(nextMonth.getMonth() + 1);
                                                        targetMonth = nextMonth;
                                                    }

                                                    // Set to end of that month as default due date
                                                    const year = targetMonth.getFullYear();
                                                    const month = targetMonth.getMonth();
                                                    const lastDay = new Date(year, month + 1, 0).getDate();
                                                    const targetDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

                                                    setTargetStatementDate(targetDateStr);
                                                }
                                            }}
                                            className="w-full border border-green-200 rounded px-2 py-1 text-gray-900 focus:ring-green-500 focus:border-green-500 bg-white"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Monto</p>
                                        <div className="relative">
                                            <span className="absolute left-2 top-1 text-gray-500">$</span>
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={parsed.amount}
                                                onChange={e => setParsed({ ...parsed, amount: parseFloat(e.target.value) || 0 })}
                                                className="w-full border border-green-200 rounded pl-5 py-1 text-gray-900 font-bold focus:ring-green-500 focus:border-green-500 bg-white"
                                            />
                                        </div>
                                    </div>
                                    <div className="col-span-2">
                                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Comercio</p>
                                        <input
                                            type="text"
                                            value={parsed.merchant}
                                            onChange={e => setParsed({ ...parsed, merchant: e.target.value, description: parsed.installments > 1 ? e.target.value : e.target.value })}
                                            className="w-full border border-green-200 rounded px-2 py-1 text-gray-900 focus:ring-green-500 focus:border-green-500 bg-white"
                                        />
                                    </div>
                                    <div>
                                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Tarjeta (Term.)</p>
                                        <input
                                            type="text"
                                            value={parsed.lastFour}
                                            onChange={e => setParsed({ ...parsed, lastFour: e.target.value })}
                                            className="w-full border border-green-200 rounded px-2 py-1 text-gray-900 focus:ring-green-500 focus:border-green-500 bg-white"
                                            placeholder="Ej: 1234"
                                            maxLength={4}
                                        />
                                    </div>
                                    <div>
                                        <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Cuotas</p>
                                        <input
                                            type="number"
                                            value={parsed.installments}
                                            onChange={e => setParsed({ ...parsed, installments: parseInt(e.target.value) || 1 })}
                                            className="w-full border border-green-200 rounded px-2 py-1 text-gray-900 focus:ring-green-500 focus:border-green-500 bg-white"
                                            min="1"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                                <h4 className="font-semibold text-blue-800 mb-2 text-sm flex items-center gap-2">
                                    📅 Afectar al Resumen
                                </h4>
                                <p className="text-xs text-blue-600 mb-3">
                                    Confirma en qué resumen debe entrar este gasto.
                                </p>
                                <div>
                                    <p className="text-gray-500 text-xs uppercase tracking-wider mb-1">Fecha de Vencimiento del Resumen</p>
                                    <input
                                        type="date"
                                        value={targetStatementDate}
                                        onChange={e => setTargetStatementDate(e.target.value)}
                                        className="w-full border border-blue-200 rounded px-2 py-1 text-gray-900 focus:ring-blue-500 focus:border-blue-500 bg-white font-medium"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 justify-end mt-6">
                                <button
                                    onClick={() => setParsed(null)}
                                    className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors font-medium text-sm"
                                >
                                    Volver / Corregir
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={loading}
                                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold text-sm disabled:opacity-50 shadow-sm flex items-center gap-2"
                                >
                                    {loading ? 'Guardando...' : 'Confirmar Importación'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
