// n8n Code node: Confirmation Router
// Requiere como entrada el objeto normalizado por code-normalize-evolution-event.js.
// Usa workflow static data para guardar una accion pendiente por telefono.

const item = $json;
const phone = item.phone;
const text = String(item.text || '').trim().toLowerCase();
const staticData = $getWorkflowStaticData('global');
staticData.pendingConfirmations ||= {};

const pending = staticData.pendingConfirmations[phone];
const yes = ['si', 'sí', 'confirmo', 'confirmar', 'ok', 'dale', 'cargar', 'guarda', 'guardar'];
const no = ['no', 'cancelar', 'cancela', 'anular', 'descartar'];

if (pending && Date.now() > pending.expiresAt) {
  delete staticData.pendingConfirmations[phone];
}

if (pending && yes.includes(text)) {
  delete staticData.pendingConfirmations[phone];
  return [{
    json: {
      ...item,
      route: 'execute_pending',
      assistantRequest: {
        ...pending.assistantRequest,
        sourcePhone: phone,
        confirmed: true
      }
    }
  }];
}

if (pending && no.includes(text)) {
  delete staticData.pendingConfirmations[phone];
  return [{
    json: {
      ...item,
      route: 'cancel_pending',
      reply: 'Cancelado. No hice cambios.'
    }
  }];
}

return [{
  json: {
    ...item,
    route: 'new_request'
  }
}];
