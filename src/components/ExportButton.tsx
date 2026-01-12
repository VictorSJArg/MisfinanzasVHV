'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function ExportButton() {
    const [exporting, setExporting] = useState(false);
    const [copying, setCopying] = useState(false);

    const fetchDataAndPrepareWorkbook = async () => {
        // 1. Fetch Flow Data (Current Year)
        const currentYear = new Date().getFullYear();
        const flowRes = await fetch(`/api/flow?start=${currentYear}-01-01&end=${currentYear}-12-31&granularity=month`);
        const flowData = await flowRes.json();

        // 2. Fetch Credit Cards Data
        const cardsRes = await fetch('/api/credit-cards');
        const cardsData = await cardsRes.json();

        // 3. Fetch TC Projections
        const projRes = await fetch('/api/credit-cards/projections');
        const projData = await projRes.json();

        // --- Generate Sheets ---
        const wb = XLSX.utils.book_new();

        // Sheet 1: Flujo de Caja
        const flowRows = [];
        const columnHeaders = flowData.columns.map((c: any) => c.labelMain + (c.labelSub ? ` - ${c.labelSub}` : ''));
        flowRows.push(['Categoría', ...columnHeaders]);

        const allFlowRows = [...(flowData.incomeRows || []), ...(flowData.expenseRows || [])];
        allFlowRows.forEach((row: any) => {
            flowRows.push([row.category.name, ...row.cells]);
            if (row.subRows) {
                row.subRows.forEach((sub: any) => {
                    flowRows.push([`  ${sub.category.name}`, ...sub.cells]);
                });
            }
        });
        const wsFlow = XLSX.utils.aoa_to_sheet(flowRows);
        XLSX.utils.book_append_sheet(wb, wsFlow, "Flujo de Caja");

        // Sheet 2: Tarjetas Items
        const tcItemsRows = [['Tarjeta', 'Fecha', 'Descripción', 'Categoría', 'Tipo', 'Monto', 'Cuotas(Act/Tot)', 'Proyección Manual', 'Incluido']];
        cardsData.forEach((card: any) => {
            if (card.statements && card.statements.length > 0) {
                const items = card.statements[0].items;
                items.forEach((item: any) => {
                    tcItemsRows.push([
                        card.name,
                        new Date(item.date).toLocaleDateString(),
                        item.description,
                        item.category || 'Sin cat.',
                        item.itemType,
                        item.amount,
                        item.installmentTotal ? `${item.installmentCurrent}/${item.installmentTotal}` : '-',
                        item.projectedAmount || '-',
                        item.includeInProjection ? 'Si' : 'No'
                    ]);
                });
            }
        });
        const wsTC = XLSX.utils.aoa_to_sheet(tcItemsRows);
        XLSX.utils.book_append_sheet(wb, wsTC, "Items Tarjetas");

        // Sheet 3: Proyecciones TC
        if (projData.projections) {
            const projRows = [['Fecha', 'Tarjeta', 'Descripción', 'Tipo', 'Categoría', 'Monto']];
            projData.projections.forEach((p: any) => {
                projRows.push([
                    new Date(p.date).toLocaleDateString(),
                    p.cardName,
                    p.description,
                    p.type,
                    p.category || '-',
                    p.amount
                ]);
            });
            const wsProj = XLSX.utils.aoa_to_sheet(projRows);
            XLSX.utils.book_append_sheet(wb, wsProj, "Proyecciones TC");
        }

        return wb;
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const wb = await fetchDataAndPrepareWorkbook();
            XLSX.writeFile(wb, `MisFinanzas_${new Date().toISOString().split('T')[0]}.xlsx`);
            alert('Archivo descargado correctamente. Revisa tu carpeta de Descargas.');
        } catch (error) {
            console.error(error);
            alert('Error exportando datos');
        } finally {
            setExporting(false);
        }
    };

    const handleCopyToClipboard = async () => {
        setCopying(true);
        try {
            const wb = await fetchDataAndPrepareWorkbook();
            // Get Flow sheet as CSV (using Tab delimiter for pasting)
            const ws = wb.Sheets["Flujo de Caja"];
            const tsv = XLSX.utils.sheet_to_csv(ws, { FS: "\t" });

            await navigator.clipboard.writeText(tsv);
            alert('¡Datos copiados! \n\n1. Ve a Google Sheets (escribe sheets.new en tu navegador).\n2. Pega los datos (Ctrl + V).');
        } catch (error) {
            console.error(error);
            alert('Error al copiar al portapapeles');
        } finally {
            setCopying(false);
        }
    };

    return (
        <div className="flex gap-2">
            <button
                onClick={handleExport}
                disabled={exporting || copying}
                className={`flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm text-sm font-medium ${exporting ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
                {exporting ? '⏳...' : '📥 Excel'}
            </button>
            <button
                onClick={handleCopyToClipboard}
                disabled={exporting || copying}
                className={`flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-sm font-medium ${copying ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
                {copying ? '⏳...' : '📋 Copiar para Sheets'}
            </button>
        </div>
    );
}
