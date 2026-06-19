# Asistente por WhatsApp con n8n + Evolution API

Este proyecto queda preparado para que n8n sea el orquestador del asistente y Evolution API maneje el numero de WhatsApp dedicado.

Paquete de agente listo para montar en n8n:

- `docs/n8n/mis-finanzas-whatsapp-agent.workflow.json`: workflow importable directo en n8n.
- `docs/n8n/whatsapp-agent-finanzas.md`: arquitectura completa del flujo.
- `docs/n8n/finanzas-agent-system-prompt.md`: prompt del agente.
- `docs/n8n/code-*.js`: snippets para nodos Code de n8n.

## Actualizar n8n despues de cambios

El deploy de Vercel actualiza la app, pero no modifica automaticamente los nodos que ya existen en n8n.

Cuando cambien el prompt, las reglas de contacto, las confirmaciones o la estructura del workflow, hay que importar o actualizar en n8n este archivo:

```text
docs/n8n/mis-finanzas-whatsapp-agent.workflow.json
```

Luego activar el workflow y probar desde WhatsApp con:

- `que tengo para hoy`
- `mandale a Antonia mi amor que llego 10 minutos tarde`
- responder `SI` al mensaje de confirmacion

## Importar contactos desde Google Contacts

Para que el asistente pueda enviar WhatsApps por nombre, los contactos deben estar cargados en la agenda interna de la app.

Pasos:

1. Ir a Google Contacts.
2. Exportar contactos en formato `CSV de Google`.
3. Entrar a `/asistente`.
4. En `Contactos y WhatsApp`, usar `Elegir CSV`.

La app evita duplicados por telefono y normaliza celulares argentinos comunes al formato de WhatsApp `549...`.

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

### asistente personal MVP

El endpoint tambien soporta acciones de secretario personal:

- `personal_overview`: resumen de agenda, tareas, recordatorios y mensajes.
- `search_personal_items`: busqueda de tareas, recordatorios, eventos y contactos.
- `create_personal_contact`: alta o actualizacion de contacto.
- `create_personal_reminder`: crear recordatorio.
- `create_personal_task`: crear tarea.
- `create_personal_event`: agendar evento o reunion.
- `create_outbound_message`: preparar WhatsApp sin enviarlo.
- `send_outbound_message`: enviar WhatsApp con confirmacion previa.
- `update_personal_task`: cambiar estado de tarea.
- `update_personal_reminder`: cambiar estado de recordatorio.

Las acciones que modifican agenda o envian WhatsApp deben llamarse primero con `confirmed:false`; la app responde `requiresConfirmation:true` y luego n8n reintenta con `confirmed:true` cuando el usuario responde `SI`.

## Etapa 2: automatizaciones personales

La app expone:

```http
GET /api/personal-assistant/dispatch
```

Este endpoint procesa:

- recordatorios personales que vencieron en la ventana puntual reciente;
- eventos de agenda que empiezan en la ventana puntual reciente;
- WhatsApps programados que vencieron en la ventana puntual reciente;
- resumen diario del asistente, usando el telefono y horario configurados en Alertas.

Para probar sin enviar:

```http
GET /api/personal-assistant/dispatch?manualTest=true&dryRun=true
```

En Vercel se ejecuta una vez por dia desde `vercel.json`, a la hora de resumen. El resumen diario se manda como maximo una vez por dia y solo durante la hora configurada en Alertas, por defecto 7 de la mañana.

## Etapa 3: scheduler externo de recordatorios y eventos

Los avisos puntuales ya no dependen de un cron frecuente. Cuando la app crea o reprograma un recordatorio, evento o WhatsApp programado, crea un `AssistantScheduledAlert` y lo publica en un workflow separado de n8n:

```text
docs/n8n/mis-finanzas-personal-scheduler.workflow.json
```

Variables necesarias en Vercel:

```env
APP_BASE_URL=https://URL_PUBLICA_DE_LA_APP
N8N_PERSONAL_SCHEDULER_WEBHOOK_URL=https://URL_N8N/webhook/mis-finanzas-personal-scheduler
N8N_PERSONAL_SCHEDULER_TOKEN=TOKEN_COMPARTIDO
```

Configurar el mismo token en el nodo `Config` del workflow de n8n. Flujo:

1. La app guarda el item y publica el job a n8n con `scheduledAlertId`, `scheduledFor`, `sourceType`, `sourceId`, `version` y `callbackUrl`.
2. n8n responde enseguida a la app.
3. n8n espera hasta `scheduledFor`.
4. n8n llama `POST /api/personal-assistant/scheduled-alert` con `Authorization: Bearer TOKEN_COMPARTIDO`.
5. La app valida que el job siga `SCHEDULED`, que no haya una version mas nueva, que el recordatorio/evento siga pendiente y que aun corresponda enviar.
6. Si todo esta bien, la app manda WhatsApp y marca el job como `SENT`; si no, lo marca como `SKIPPED`, `FAILED` o `CANCELLED`.

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
