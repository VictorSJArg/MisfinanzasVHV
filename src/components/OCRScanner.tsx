'use client';

import { useState, useCallback } from 'react';
import Tesseract from 'tesseract.js';

interface ParsedItem {
    date: string;
    description: string;
    amount: string;
    amountUSD: string;
    installment: string;
    category: string;
}

interface OCRScannerProps {
    onItemsExtracted: (items: ParsedItem[]) => void;
    onStatementInfo: (info: { closingDate?: string; dueDate?: string; totalAmount?: string; minimumPayment?: string }) => void;
}

export default function OCRScanner({ onItemsExtracted, onStatementInfo }: OCRScannerProps) {
    const [processing, setProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [rawText, setRawText] = useState('');
    const [showRawText, setShowRawText] = useState(false);

    const parseStatementText = (text: string): { items: ParsedItem[], info: any } => {
        const lines = text.split('\n').filter(l => l.trim());
        const items: ParsedItem[] = [];
        const info: any = {};

        console.log('OCR Raw Text:', text);

        // Patrones más flexibles para Banco San Juan
        const datePattern = /(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{2}\/\d{2})/g;
        const installmentPattern = /C\.(\d{2})\/(\d{2})/;

        // Patrones para encabezado - más flexibles
        // VENCIMIENTO ACTUAL: 30/12/25 o PROXIMO VTO.: 30/01/26
        const vencimientoPatterns = [
            /VENCIMIENTO\s*(?:ACTUAL)?[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i,
            /PROXIMO\s*VTO\.?[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i,
            /VTO\.?\s*[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i
        ];

        // CIERRE ACTUAL: 24/12/25 o PROXIMO CIERRE: 22/01/26
        const cierrePatterns = [
            /CIERRE\s*(?:ACTUAL)?[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i,
            /PROXIMO\s*CIERRE[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i
        ];

        // SALDO ACTUAL: $ 1.149.514,56
        const saldoPatterns = [
            /SALDO\s*ACTUAL[:\s]*\$?\s*([\d\.\s]+[,]\d{2})/i,
            /SALDO\s*ACTUAL[:\s]*\$?\s*([\d.,]+)/i
        ];

        // PAGO MINIMO: $ 147.474,00
        const pagoMinimoPatterns = [
            /PAGO\s*M[IÍ]NIMO[:\s]*\$?\s*([\d\.\s]+[,]\d{2})/i,
            /PAGO\s*M[IÍ]NIMO[:\s]*\$?\s*([\d.,]+)/i
        ];

        // Buscar vencimiento
        for (const pattern of vencimientoPatterns) {
            const match = text.match(pattern);
            if (match) {
                info.dueDate = parseDate(match[1]);
                console.log('Found dueDate:', match[1], '->', info.dueDate);
                break;
            }
        }

        // Buscar cierre
        for (const pattern of cierrePatterns) {
            const match = text.match(pattern);
            if (match) {
                info.closingDate = parseDate(match[1]);
                console.log('Found closingDate:', match[1], '->', info.closingDate);
                break;
            }
        }

        // Buscar saldo
        for (const pattern of saldoPatterns) {
            const match = text.match(pattern);
            if (match) {
                info.totalAmount = parseAmount(match[1]);
                console.log('Found totalAmount:', match[1], '->', info.totalAmount);
                break;
            }
        }

        // Buscar pago mínimo
        for (const pattern of pagoMinimoPatterns) {
            const match = text.match(pattern);
            if (match) {
                info.minimumPayment = parseAmount(match[1]);
                console.log('Found minimumPayment:', match[1], '->', info.minimumPayment);
                break;
            }
        }

        // Procesar líneas para encontrar transacciones
        for (const line of lines) {
            // Ignorar líneas de totales o encabezados
            if (line.match(/total|saldo\s*anterior|pago\s*en\s*pesos|transferencia\s*deuda/i)) continue;

            // Buscar líneas que parecen transacciones (tienen fecha al inicio y monto al final)
            const dates = line.match(datePattern);
            const amounts = line.match(/[\d.,]+/g);

            if (dates && dates.length > 0 && amounts && amounts.length > 0) {
                const installmentMatch = line.match(installmentPattern);

                // Extraer descripción
                let description = line;
                // Quitar fecha al inicio
                if (dates[0]) {
                    description = description.replace(dates[0], '').trim();
                }
                // Quitar número de comprobante (ej: 001815 * o 729425 *)
                description = description.replace(/^\d{6}\s*\*?\s*/, '').trim();
                // Quitar letra K o similar al inicio
                description = description.replace(/^[A-Z]\s+/, '').trim();
                // Quitar cuota del final si está
                description = description.replace(/C\.\d{2}\/\d{2}/gi, '').trim();
                // Quitar montos del final (números con puntos y comas)
                description = description.replace(/[\d.,]+[\-]?\s*$/g, '').trim();
                description = description.replace(/[\d.,]+[\-]?\s*$/g, '').trim();
                description = description.replace(/[\d.,]+\s*$/g, '').trim();

                // Obtener el último monto válido (mayor a 100, para evitar cuotas)
                let mainAmount = '';
                for (let i = amounts.length - 1; i >= 0; i--) {
                    const amt = parseAmount(amounts[i]);
                    if (parseFloat(amt) > 100 || i === amounts.length - 1) {
                        mainAmount = amt;
                        break;
                    }
                }

                // Verificar si hay USD
                const hasUSD = line.includes('USD') || line.includes('U$S') || line.includes('CUSD');

                // Solo agregar si la descripción es válida
                if (description && description.length > 2 && !description.match(/^[\d\s\-\/\.]+$/)) {
                    const cleanDesc = cleanDescription(description).substring(0, 100);
                    items.push({
                        date: dates[0] ? formatDateForInput(dates[0]) : '',
                        description: cleanDesc,
                        amount: mainAmount,
                        amountUSD: hasUSD && amounts.length > 1 ? parseAmount(amounts[amounts.length - 2]) : '',
                        installment: installmentMatch ? `C.${installmentMatch[1]}/${installmentMatch[2]}` : '',
                        category: detectCategory(cleanDesc)
                    });
                }
            }
        }

        console.log('Parsed items:', items.length, 'Info:', info);
        return { items, info };
    };

    // Auto-detect category based on description keywords
    const detectCategory = (description: string): string => {
        const desc = description.toUpperCase();

        // Combustibles
        if (desc.match(/YPF|SHELL|AXION|PUMA|PETROBRAS|COMBUSTIBLE|NAFTA|GNC|ESTACION|SERVICE|AUTOSERVICE/)) {
            return 'COMBUSTIBLE';
        }
        // Supermercados y Alimentos
        if (desc.match(/COTO|CARREFOUR|JUMBO|DIA|CHANGOMAS|VEA|DISCO|WALMART|SUPERMERCADO|ALMACEN|PANADERIA|CARNICERIA|VERDULERIA|GRANJA/)) {
            return 'ALIMENTOS';
        }
        // Servicios digitales y streaming
        if (desc.match(/NETFLIX|SPOTIFY|AMAZON|DISNEY|HBO|YOUTUBE|GOOGLE|APPLE|MICROSOFT|MERCADOLIBRE|STEAM|PLAYSTATION|XBOX/)) {
            return 'ENTRETENIMIENTO';
        }
        // Servicios básicos
        if (desc.match(/CLARO|MOVISTAR|PERSONAL|TELECENTRO|FIBERTEL|CABLEVISION|EDENOR|EDESUR|METROGAS|AYSA|MUNICIPALIDAD|RENTAS|ABL/)) {
            return 'SERVICIOS';
        }
        // Seguros
        if (desc.match(/SEGURO|SEGUROS|GALENO|OSDE|SWISS|SANCOR|FEDERACION|PATRONAL|ZURICH|MAPFRE/)) {
            return 'SEGUROS';
        }
        // Salud y Farmacias
        if (desc.match(/FARMACITY|FARMACIA|DOCTOR|CONSULTORIO|HOSPITAL|CLINICA|LABORATORIO|OPTICA/)) {
            return 'SALUD';
        }
        // Restaurantes y delivery
        if (desc.match(/RAPPI|PEDIDOS|UBER\s*EATS|MCDONALDS|BURGER|STARBUCKS|RESTAURANT|DELIVERY|PIZZERIA|CAFETERIA/)) {
            return 'GASTRONOMIA';
        }
        // Ropa y calzado
        if (desc.match(/ZARA|H&M|NIKE|ADIDAS|FALABELLA|ROPA|CALZADO|INDUMENTARIA|MODA/)) {
            return 'ROPA';
        }
        // Transporte
        if (desc.match(/CABIFY|UBER|PEAJE|AUTOPISTA|SUBTE|COLECTIVO|TAXI|ESTACIONAMIENTO/)) {
            return 'TRANSPORTE';
        }
        // Impuestos
        if (desc.match(/IVA|IMPUESTO|PERCEPCION|RETENCION|AFIP|IIBB/)) {
            return 'IMPUESTOS';
        }
        // Intereses y cargos bancarios
        if (desc.match(/INTERES|CARGO|COMISION|SEGURO.*VIDA|MORA|GASTO.*MANTENIMIENTO/)) {
            return 'CARGOS';
        }

        return 'OTROS';
    };

    const parseDate = (dateStr: string): string => {
        // Convertir DD/MM/YY o DD/MM/YYYY a YYYY-MM-DD
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            let year = parts[2];
            if (year.length === 2) {
                year = '20' + year;
            }
            return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return '';
    };

    const formatDateForInput = (dateStr: string): string => {
        const parts = dateStr.split('/');
        if (parts.length >= 3) {
            let year = parts[2];
            if (year.length === 2) {
                year = '20' + year;
            }
            return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return '';
    };

    const parseAmount = (amountStr: string): string => {
        // Limpiar y convertir el monto
        return amountStr
            .replace(/\./g, '') // Quitar puntos de miles
            .replace(',', '.') // Convertir coma decimal a punto
            .replace(/[^\d.]/g, ''); // Solo números y punto
    };

    const cleanDescription = (desc: string): string => {
        return desc
            .replace(/\s+/g, ' ')
            .replace(/^[\*\s]+/, '')
            .replace(/[\*\s]+$/, '')
            .trim();
    };

    const handleFileUpload = useCallback(async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        setProcessing(true);
        setProgress(0);
        const allItems: ParsedItem[] = [];
        let combinedInfo: any = {};

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                const result = await Tesseract.recognize(
                    file,
                    'spa', // Spanish language
                    {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                setProgress(Math.round(((i + m.progress) / files.length) * 100));
                            }
                        }
                    }
                );

                setRawText(prev => prev + '\n---PAGE---\n' + result.data.text);

                const { items, info } = parseStatementText(result.data.text);
                allItems.push(...items);
                combinedInfo = { ...combinedInfo, ...info };
            }

            // Eliminar duplicados basados en descripción y monto
            const uniqueItems = allItems.filter((item, index, self) =>
                index === self.findIndex(t =>
                    t.description === item.description &&
                    t.amount === item.amount &&
                    t.date === item.date
                )
            );

            onItemsExtracted(uniqueItems);
            onStatementInfo(combinedInfo);

        } catch (error) {
            console.error('OCR Error:', error);
            alert('Error al procesar las imágenes. Intenta con imágenes más claras.');
        } finally {
            setProcessing(false);
        }
    }, [onItemsExtracted, onStatementInfo]);

    return (
        <div className="space-y-4">
            <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-indigo-400 transition-colors">
                <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={e => handleFileUpload(e.target.files)}
                    className="hidden"
                    id="ocr-upload"
                    disabled={processing}
                />
                <label
                    htmlFor="ocr-upload"
                    className={`cursor-pointer ${processing ? 'pointer-events-none' : ''}`}
                >
                    {processing ? (
                        <div className="space-y-3">
                            <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto"></div>
                            <p className="text-indigo-600 font-medium">Procesando imágenes... {progress}%</p>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-indigo-600 h-2 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="text-4xl">📷</div>
                            <p className="text-gray-600 font-medium">Subir imágenes del resumen</p>
                            <p className="text-gray-400 text-sm">Arrastra o haz clic para seleccionar</p>
                            <p className="text-xs text-gray-400">Formatos: JPG, PNG, etc.</p>
                        </div>
                    )}
                </label>
            </div>

            {rawText && (
                <div>
                    <button
                        onClick={() => setShowRawText(!showRawText)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                    >
                        {showRawText ? '▼ Ocultar texto detectado' : '▶ Ver texto detectado (debug)'}
                    </button>
                    {showRawText && (
                        <pre className="mt-2 p-3 bg-gray-100 rounded text-xs overflow-auto max-h-48 whitespace-pre-wrap">
                            {rawText}
                        </pre>
                    )}
                </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                <p className="text-amber-800">
                    <strong>💡 Consejos para mejor precisión:</strong>
                </p>
                <ul className="text-amber-700 text-xs mt-1 space-y-1">
                    <li>• Usa imágenes claras y bien iluminadas</li>
                    <li>• Sube cada página del resumen por separado</li>
                    <li>• Revisa y corrige los datos extraídos antes de guardar</li>
                </ul>
            </div>
        </div>
    );
}
