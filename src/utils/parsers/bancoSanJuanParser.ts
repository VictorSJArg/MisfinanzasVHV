
export interface ParsedEmailTransaction {
    date: string;       // YYYY-MM-DD
    amount: number;
    description: string;
    lastFour: string;
    installments: number;
    merchant: string;
    manualStatementDate?: string;
}

export const parseBancoSanJuanEmail = (text: string): ParsedEmailTransaction | null => {
    try {
        // Cleaning text to ensure reliable regex matching (handling potential hidden chars)
        const cleanText = text.replace(/\r/g, '').trim();

        // Regex Patterns based on user sample
        // Helper to find any date if specific format missing
        const fallbackDateMatch = cleanText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
        const dateMatch = cleanText.match(/Fecha[^0-9]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i) || fallbackDateMatch;

        // Date Parsing
        let date = new Date().toISOString().split('T')[0]; // Default to today
        if (dateMatch) {
            const datePart = dateMatch[1].replace(/-/g, '/');
            const [day, month, year] = datePart.split('/');
            date = `${year}-${month}-${day}`;
        }

        // Amount Parsing
        // 1. Try strict "Importe..." match
        // 2. Try just finding the largest number with decimals that is not a date
        const amountFullMatch = cleanText.match(/Importe(?: a pagar)?[:;\s|]*([0-9.,\s]+)/i);
        let amountStr = '';

        if (amountFullMatch) {
            amountStr = amountFullMatch[1];
        } else {
            // Fallback: Find all numbers that look like money (e.g. 123.45 or 123,45)
            // excluding likely date parts (2026, 01)
            const moneyMatches = cleanText.matchAll(/(?:\$|PESOS)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*[.,][0-9]{2})/gi);
            // This is complex. Let's simplify fallback: Look for any number > 100 with decimals
            const allNums = cleanText.match(/[0-9]+[.,][0-9]{2}/g);
            if (allNums && allNums.length > 0) {
                // Take the last one? Or the largest? Usually total is last or largest.
                // Let's assume the specific "66855.87" format which has point.
                amountStr = allNums.find(n => n.length > 5) || allNums[0];
            }
        }

        // Clean Amount
        let amount = 0;
        if (amountStr) {
            amountStr = amountStr.trim().replace(/\s/g, '');
            // Heuristic for separators
            const dotIndex = amountStr.lastIndexOf('.');
            const commaIndex = amountStr.lastIndexOf(',');

            if (dotIndex > -1 && commaIndex > -1) {
                if (commaIndex > dotIndex) amountStr = amountStr.replace(/\./g, '').replace(',', '.'); // AR
                else amountStr = amountStr.replace(/,/g, ''); // US
            } else if (commaIndex > -1) {
                amountStr = amountStr.replace(',', '.');
            }
            amount = parseFloat(amountStr) || 0;
        }

        // Merchant
        const merchantMatch = cleanText.match(/Comercio[:;\s|]*([^\n\r]+?)(?=\s*(?:Nro|Comprobante|Cuotas|Importe|$))/i);
        let merchant = merchantMatch ? merchantMatch[1].trim() : 'COMERCIO DESCONOCIDO';
        // Cleanup merchant name junk
        merchant = merchant.replace(/^[:;\s]+/, '').replace(/[\*]+/, ' ');

        // Last Four
        const lastFourMatch = cleanText.match(/Tarjeta.*?[xX]+(\d{4})/i) || cleanText.match(/Tarjeta.*?(\d{4})/i);
        const lastFour = lastFourMatch ? lastFourMatch[1] : '';

        // Installments
        const installmentsMatch = cleanText.match(/Cuotas[:;\s|]*(\d+)/i);
        const installments = installmentsMatch ? parseInt(installmentsMatch[1], 10) : 1;

        // Description check
        // If merchant is unknown, try to guess from uppercase lines? 
        // Too risky. 'COMERCIO DESCONOCIDO' is a good signal for user to edit.

        const description = installments > 1 ? merchant : merchant;

        return {
            date,
            amount,
            description,
            lastFour,
            installments,
            merchant
        };

    } catch (e) {
        console.error('Error parsing email:', e);
        return null;
    }
};
