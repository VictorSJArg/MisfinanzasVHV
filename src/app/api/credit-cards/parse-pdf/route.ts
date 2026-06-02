import '@/utils/dommatrix-polyfill';
import { NextRequest, NextResponse } from 'next/server';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No se subió ningún archivo' }, { status: 400 });
        }

        // Validate file type (PDF/Adobe Acrobat Document)
        const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
        if (!isPdf) {
            return NextResponse.json({ error: 'El archivo debe ser en formato PDF' }, { status: 400 });
        }

        const arrayBuffer = await file.arrayBuffer();
        const data = new Uint8Array(arrayBuffer);

        // Load PDF with password
        const loadingTask = pdfjsLib.getDocument({
            data,
            password: '23633922',
            useSystemFonts: true,
            disableFontFace: true
        });

        const pdf = await loadingTask.promise;
        console.log(`API Parse PDF: Loaded PDF with ${pdf.numPages} pages.`);

        let fullText = '';
        const tolerance = 4; // Tolerance in points for vertical line grouping

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = textContent.items;

            // Group by Y coordinate
            const linesMap: { [key: number]: { x: number; str: string }[] } = {};

            for (const item of items) {
                // Assert type for text item
                if (!('str' in item) || !item.str.trim()) continue;

                const x = item.transform[4];
                const y = item.transform[5];

                let matchedY: string | null = null;
                for (const existingY of Object.keys(linesMap)) {
                    if (Math.abs(parseFloat(existingY) - y) < tolerance) {
                        matchedY = existingY;
                        break;
                    }
                }

                if (matchedY !== null) {
                    linesMap[parseFloat(matchedY)].push({ x, str: item.str });
                } else {
                    linesMap[y] = [{ x, str: item.str }];
                }
            }

            // Sort lines by Y descending (top of page to bottom)
            const sortedY = Object.keys(linesMap).map(Number).sort((a, b) => b - a);

            let pageText = '';
            for (const y of sortedY) {
                // Sort items on the line by X ascending (left to right)
                const lineItems = linesMap[y].sort((a, b) => a.x - b.x);

                let lineStr = '';
                for (const item of lineItems) {
                    if (lineStr === '') {
                        lineStr = item.str;
                    } else {
                        lineStr += ' ' + item.str;
                    }
                }
                pageText += lineStr + '\n';
            }

            fullText += `\n--- PAGE ${i} ---\n` + pageText;
        }

        // Parse extracted text to identify statement headers and transaction items
        const result = parsePDFText(fullText);

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Error parsing PDF:', error);
        return NextResponse.json({ error: `Error al procesar el PDF: ${error.message}` }, { status: 500 });
    }
}

function parseDate(dateStr: string): string {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        let year = parts[2];
        if (year.length === 2) {
            year = '20' + year;
        }
        return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return '';
}

function parseAmount(amountStr: string): string {
    if (!amountStr) return '';
    return amountStr
        .replace(/\./g, '') // Remove thousands separator dot
        .replace(',', '.') // Convert decimal comma to dot
        .replace(/[^\d.]/g, ''); // Keep only numbers and dot
}

function parsePDFText(text: string) {
    const lines = text.split('\n').filter(l => l.trim());
    const items: any[] = [];
    const info: any = {};

    // Header patterns
    const vencimientoPatterns = [
        /VENCIMIENTO\s*(?:ACTUAL)?[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i,
        /PROXIMO\s*VTO\.?[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i,
        /VTO\.?\s*[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i
    ];

    const cierrePatterns = [
        /CIERRE\s*(?:ACTUAL)?[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i,
        /PROXIMO\s*CIERRE[:\s]*(\d{2}\/\d{2}\/\d{2,4})/i
    ];

    const saldoPatterns = [
        /SALDO\s*ACTUAL[:\s]*\$?\s*([\d\.\s]+[,]\d{2})/i,
        /SALDO\s*ACTUAL[:\s]*\$?\s*([\d.,]+)/i,
        /SALDO\s*ACTUAL\s*EN\s*PESOS[:\s]*\$?\s*([\d\.\s]+[,]\d{2})/i
    ];

    const pagoMinimoPatterns = [
        /PAGO\s*M[IÍ]NIMO[:\s]*\$?\s*([\d\.\s]+[,]\d{2})/i,
        /PAGO\s*M[IÍ]NIMO[:\s]*\$?\s*([\d.,]+)/i
    ];

    // Search headers
    for (const pattern of vencimientoPatterns) {
        const match = text.match(pattern);
        if (match) {
            info.dueDate = parseDate(match[1]);
            break;
        }
    }

    for (const pattern of cierrePatterns) {
        const match = text.match(pattern);
        if (match) {
            info.closingDate = parseDate(match[1]);
            break;
        }
    }

    for (const pattern of saldoPatterns) {
        const match = text.match(pattern);
        if (match) {
            info.totalAmount = parseAmount(match[1]);
            break;
        }
    }

    for (const pattern of pagoMinimoPatterns) {
        const match = text.match(pattern);
        if (match) {
            info.minimumPayment = parseAmount(match[1]);
            break;
        }
    }

    // Transaction rows parser
    const txLineRegex = /^(\d{2}\/\d{2}\/\d{2,4})\s+(.*)$/;
    const installmentPattern = /C\.(\d{2})\/(\d{2})/;

    for (const line of lines) {
        const cleanLine = line.trim();
        // Ignore header lines or section totals
        if (cleanLine.match(/total|saldo\s*anterior|pago\s*en\s*pesos|transferencia\s*deuda|limites:|cierre\s*actual|vencimiento\s*actual/i)) {
            continue;
        }

        const match = cleanLine.match(txLineRegex);
        if (match) {
            const dateStr = match[1];
            let remainder = match[2].trim();

            if (remainder.toLowerCase().includes('total consumos de')) {
                continue;
            }

            const instMatch = remainder.match(installmentPattern);
            let installment = '';
            if (instMatch) {
                installment = `C.${instMatch[1]}/${instMatch[2]}`;
            }

            const tokens = remainder.split(/\s+/);
            let amountPesos = '';
            let amountUSD = '';

            const numbers = [];
            let descEndIndex = tokens.length;

            for (let i = tokens.length - 1; i >= 0; i--) {
                const token = tokens[i].replace('$', '').trim();
                const isNum = token.match(/^-?[\d\.]+,?\d*$/);
                if (isNum) {
                    numbers.push({ index: i, val: token });
                    descEndIndex = i;
                } else {
                    if (numbers.length > 0) {
                        if (token === '*' || token === 'USD' || token === 'U$S' || token === 'K' || token === 'V' || token === 'P') {
                            descEndIndex = i;
                            continue;
                        }
                        break;
                    }
                }
            }

            let description = tokens.slice(0, descEndIndex).join(' ');

            // Clean description formatting
            description = description
                .replace(/^\d{6}\s*\*?\s*/, '') // Remove voucher ID
                .replace(/^[A-Z]\s+/, '') // Remove control letters
                .replace(/[\$\*\s\-]+$/, '') // Remove trailing symbols
                .replace(/\s+/g, ' ')
                .trim();

            const isUSD = line.includes('USD') || line.includes('U$S') || line.includes('CUSD') || description.toUpperCase().includes('USD');

            if (numbers.length > 0) {
                if (isUSD) {
                    amountUSD = parseAmount(numbers[0].val);
                    amountPesos = '';
                } else {
                    amountPesos = parseAmount(numbers[0].val);
                }
            }

            if (description && description.length > 2 && !description.match(/^[\d\s\-\/\.]+$/)) {
                items.push({
                    date: parseDate(dateStr),
                    description: description,
                    amount: amountPesos,
                    amountUSD: amountUSD,
                    installment: installment
                });
            }
        }
    }

    return { info, items };
}
