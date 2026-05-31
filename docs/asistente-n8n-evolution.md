# Asistente por WhatsApp con n8n + Evolution API

Este proyecto queda preparado para que n8n sea el orquestador del asistente y Evolution API maneje el numero de WhatsApp dedicado.

Paquete de agente listo para montar en n8n:

- `docs/n8n/mis-finanzas-whatsapp-agent.workflow.json`: workflow importable directo en n8n.
- `docs/n8n/whatsapp-agent-finanzas.md`: arquitectura completa del flujo.
- `docs/n8n/finanzas-agent-system-prompt.md`: prompt del agente.
- `docs/n8n/code-*.js`: snippets para nodos Code de n8n.

## Flujo recomendado

1. WhatsApp dedicado recibe texto, audio o imagen.
2. Evolution API envia el evento al webhook de n8n.
3. n8n normaliza el mensaje:
   - texto: se usa directo.
   - audio: transcribir antes de decidir la accion.
   - imagen: OCR/vision antes de decidir la accion.
4. n8n interpreta la intencion y llama a esta app por HTTP.
5. Si la accion modifica datos, n8n primero pide confirmacion por WhatsApp.
6. Con confirmacion, n8n vuelve a llamar a la app con `confirmed: true`.

## Variables de entorno

En Vercel/local:

- `ASSISTANT_WEBHOOK_SECRET`: token compartido entre n8n y esta app.
- `ASSISTANT_ALLOWED_PHONE`: opcional. Numero permitido, solo digitos. Puede ser lista separada por coma.
- `APP_BASIC_AUTH_USER`: opcional. Usuario para proteger la app web con Basic Auth.
- `APP_BASIC_AUTH_PASSWORD`: opcional. Password para proteger la app web con Basic Auth.

Tambien se acepta `N8N_WEBHOOK_SECRET` como compatibilidad, pero se recomienda usar `ASSISTANT_WEBHOOK_SECRET`.

## Endpoint para n8n

`POST /api/assistant`

Headers:

```http
Authorization: Bearer <ASSISTANT_WEBHOOK_SECRET>
Content-Type: application/json
```

Body base:

```json
{
  "sourcePhone": "549XXXXXXXXXX",
  "action": "summary",
  "payload": {},
  "confirmed": false
}
```

## Acciones soportadas

### ping

```json
{ "action": "ping", "payload": {} }
```

### metadata

Devuelve categorias y cuentas disponibles.

```json
{ "action": "metadata", "payload": {} }
```

### summary

Resumen por mes.

```json
{
  "action": "summary",
  "payload": { "month": 5, "year": 2026 }
}
```

### search_transactions

Busca movimientos.

```json
{
  "action": "search_transactions",
  "payload": {
    "query": "supermercado",
    "type": "EXPENSE",
    "startDate": "2026-05-01",
    "endDate": "2026-05-31",
    "limit": 10
  }
}
```

### create_transaction

Primera llamada sin confirmacion:

```json
{
  "action": "create_transaction",
  "confirmed": false,
  "payload": {
    "amount": 12500,
    "type": "EXPENSE",
    "date": "2026-05-26",
    "description": "Supermercado",
    "categoryName": "Supermercado",
    "status": "PAID"
  }
}
```

La app responde `requiresConfirmation: true`. Despues de confirmar por WhatsApp:

```json
{
  "action": "create_transaction",
  "confirmed": true,
  "payload": {
    "amount": 12500,
    "type": "EXPENSE",
    "date": "2026-05-26",
    "description": "Supermercado",
    "categoryName": "Supermercado",
    "status": "PAID"
  }
}
```

Si n8n quiere permitir crear categorias nuevas automaticamente, agregar:

```json
{ "createMissingCategory": true }
```

### update_transaction

Requiere `confirmed: true` para aplicar.

```json
{
  "action": "update_transaction",
  "confirmed": true,
  "payload": {
    "transactionId": "id-de-la-transaccion",
    "amount": 15000,
    "description": "Supermercado corregido"
  }
}
```

### delete_transaction

Requiere `confirmed: true` para aplicar.

```json
{
  "action": "delete_transaction",
  "confirmed": true,
  "payload": {
    "transactionId": "id-de-la-transaccion"
  }
}
```

### credit_cards

Devuelve tarjetas y ultimos resumenes.

```json
{ "action": "credit_cards", "payload": {} }
```

## Reglas de seguridad para n8n

- Guardar el `messageId` de Evolution API y evitar procesarlo dos veces.
- Pedir confirmacion antes de `create_transaction`, `update_transaction` y `delete_transaction`.
- Enviar `sourcePhone` en cada llamada para que la app pueda aplicar allowlist.
- No exponer el endpoint `/api/assistant` sin `Authorization`.
- Para audio/imagenes, guardar solo lo necesario y evitar persistir comprobantes sensibles si no hace falta.
