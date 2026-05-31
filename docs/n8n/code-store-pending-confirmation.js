// n8n Code node: Store Pending Confirmation
// Entrada esperada:
// - phone
// - assistantRequest
// - appResponse con requiresConfirmation:true o HTTP 409 mapeado.

const item = $json;
const phone = item.phone || item.sourcePhone || item.original?.phone;
const assistantRequest = item.assistantRequest;
const appResponse = item.appResponse || item;

if (!phone || !assistantRequest) {
  return [{
    json: {
      route: 'reply_only',
      reply: 'No pude preparar la confirmacion.'
    }
  }];
}

const staticData = $getWorkflowStaticData('global');
staticData.pendingConfirmations ||= {};
staticData.pendingConfirmations[phone] = {
  assistantRequest,
  createdAt: Date.now(),
  expiresAt: Date.now() + 10 * 60 * 1000
};

const preview = appResponse.preview || assistantRequest.payload || {};
const amount = preview.amount ? Number(preview.amount).toLocaleString('es-AR') : '';
const type = preview.type === 'INCOME' ? 'Ingreso' : 'Gasto';
const date = preview.date || '';
const category = preview.categoryName || preview.category || '';
const description = preview.description || '';

return [{
  json: {
    route: 'send_message',
    phone,
    reply: [
      `Confirmo ${type.toLowerCase()}${amount ? ` de $${amount}` : ''}?`,
      date ? `Fecha: ${date}` : '',
      category ? `Categoria: ${category}` : '',
      description ? `Detalle: ${description}` : '',
      '',
      'Responde SI para confirmar o NO para cancelar.'
    ].filter(Boolean).join('\n')
  }
}];
