// n8n Code node: Validate Agent JSON
// Entrada esperada: salida del modelo. Adaptar `raw` al nombre del campo que devuelva tu nodo AI/OpenAI.

const raw =
  $json.output ||
  $json.text ||
  $json.message?.content ||
  $json.choices?.[0]?.message?.content ||
  '';

let parsed;
try {
  parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
} catch (error) {
  return [{
    json: {
      route: 'reply_only',
      reply: 'No pude interpretar el pedido. Probalo con monto, fecha y categoria.'
    }
  }];
}

const allowedActions = new Set([
  'metadata',
  'summary',
  'search_transactions',
  'create_transaction',
  'update_transaction',
  'delete_transaction',
  'credit_cards'
]);

if (parsed.intent === 'clarification' || parsed.intent === 'unsupported') {
  return [{
    json: {
      route: 'reply_only',
      reply: parsed.reply || 'Necesito un dato mas para avanzar.'
    }
  }];
}

const assistantRequest = parsed.assistantRequest || {};
if (!allowedActions.has(assistantRequest.action)) {
  return [{
    json: {
      route: 'reply_only',
      reply: 'No tengo habilitada esa accion.'
    }
  }];
}

if ((parsed.confidence || 0) < 0.75) {
  return [{
    json: {
      route: 'reply_only',
      reply: parsed.reply || 'No estoy seguro de haber entendido. Me lo confirmas con monto, fecha y categoria?'
    }
  }];
}

return [{
  json: {
    route: 'call_app',
    intent: parsed.intent,
    confidence: parsed.confidence,
    reply: parsed.reply,
    needsConfirmation: Boolean(parsed.needsConfirmation),
    assistantRequest
  }
}];
