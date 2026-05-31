# Agente WhatsApp para Finanzas VHV

Este documento define el agente para usar en n8n con Evolution API y un numero de WhatsApp dedicado.

## Workflow importable

Archivo listo para importar en n8n:

```text
docs/n8n/mis-finanzas-whatsapp-agent.workflow.json
```

Incluye:

- un `Webhook` para recibir mensajes de Evolution API;
- un nodo `Config` para cargar los datos de tu app y tu numero autorizado;
- un `Switch` visible llamado `Message Type` para separar texto, audio, imagen, video y no soportados;
- nodos OpenAI nativos:
  - `OpenAI Transcribe Audio`;
  - `OpenAI Analizar Imagen`;
  - `OpenAI Interpretar Pedido`;
- un `If` para enviar solo cuando corresponda responder;
- `Split Messages`, `Loop Messages`, `Send Text` y `Wait 2s`, siguiendo el patron de tus flujos actuales con Evolution;
- una nota interna con los datos que hay que completar.

El archivo fue generado desde:

```text
docs/n8n/generate-workflow-json.mjs
```

La app ya expone el endpoint seguro:

```http
POST {{APP_BASE_URL}}/api/assistant
Authorization: Bearer {{ASSISTANT_WEBHOOK_SECRET}}
Content-Type: application/json
```

## Objetivo

Permitir que puedas escribir, mandar audios o subir imagenes por WhatsApp para:

- cargar gastos e ingresos;
- consultar resumenes;
- buscar movimientos;
- pedir informacion de tarjetas;
- editar o borrar movimientos con confirmacion previa.

## Variables recomendadas en n8n

Configurar estos campos en el nodo `Config` del workflow:

```text
APP_BASE_URL=https://tu-app.vercel.app
ASSISTANT_WEBHOOK_SECRET=token-largo-compartido-con-la-app
ASSISTANT_ALLOWED_PHONE=549XXXXXXXXXX
DEFAULT_ACCOUNT_NAME=Efectivo
EVOLUTION_BASE_URL=
EVOLUTION_INSTANCE=
EVOLUTION_API_KEY=
```

OpenAI no se pega como API key en el JSON. El workflow usa la credencial existente de n8n:

```text
OpenAi account
```

El envio de WhatsApp usa por defecto los datos que ya envia Evolution al webhook:

```text
body.server_url
body.instance
body.apikey
body.data.key.remoteJid
```

Si tu webhook no trae esos campos, se pueden configurar como fallback en el mismo nodo `Config`:

```text
EVOLUTION_BASE_URL=https://tu-evolution-api
EVOLUTION_INSTANCE=nombre-instancia
EVOLUTION_API_KEY=token-evolution
```

En la app, configurar tambien:

```text
ASSISTANT_WEBHOOK_SECRET=token-largo-compartido-con-n8n
ASSISTANT_ALLOWED_PHONE=549XXXXXXXXXX
```

## Flujo principal en n8n

El flujo puede iniciarse de dos maneras:
- **Producción:** `Webhook1` recibe eventos de Evolution API (método `POST`).
- **Pruebas:** `Manual Trigger` se inicia manualmente e interactúa con el nodo `Config de Prueba` (donde se configura el texto del mensaje, teléfono de prueba, etc.).

Ambos caminos confluyen en el nodo `Config` y luego pasan al procesamiento principal:

1. `Normalizar Entrada`
   - Detecta si el flujo vino del Webhook o de la Config de Prueba.
   - Extrae de manera segura el teléfono, messageId, texto, tipo de mensaje y metadata.
   - Si es una prueba manual, genera un ID único (`test-${Date.now()}`) y usa el número de teléfono configurado.
   - Deduplica por `messageId`.
   - Permite solo tu número si `ASSISTANT_ALLOWED_PHONE` está configurado.

2. `Router Confirmaciones`
   - Lee confirmaciones pendientes en memoria estática.
   - Permite confirmar respondiendo "SI" o cancelar con "NO".

3. `Message Type` (Switch)
   - Separa en texto, audio, imagen, video y formatos no soportados.

4. Nodos de procesamiento de entrada:
   - `Preparar Texto` (para mensajes escritos).
   - `Get Audio` -> `OpenAI Transcribe Audio` -> `Preparar Audio` (para audios).
   - `OpenAI Analizar Imagen` -> `Preparar Imagen` (para comprobantes/fotos).
   - `Video o No Soportado` (para otros archivos).

5. Orquestación del Agente:
   - `Preparar Prompt Finanzas`: Consulta metadata (categorías/cuentas) de la app.
   - `OpenAI Interpretar Pedido`: Interpreta la intención usando GPT-4o-mini y produce JSON.
   - `Ejecutar Solicitud App`: Llama a `/api/assistant`. Si requiere confirmación, guarda la acción pendiente y devuelve el texto de confirmación.

6. Envío de Respuesta:
   - `If Enviar Respuesta`: Continúa solo si hay una respuesta.
   - `Split Messages`: Divide respuestas largas.
   - `Loop Messages`: Itera enviando los fragmentos.
   - `If Enviar a Evolution`: Condición para comprobar si `evolution.serverUrl` está configurado.
     - **Si está configurado:** Envía el mensaje mediante `Send Text` (HTTP Request) y espera con `Wait 2s`.
     - **Si está vacío (Prueba manual):** Evita llamar a la API y vuelve al loop directamente de forma exitosa.

## Logica interna del agente

El flujo distingue el input asi:

- texto: `conversation` o `extendedTextMessage`;
- audio: `audioMessage`, se descarga desde `mediaUrl` y pasa por `OpenAI Transcribe Audio`;
- imagen: `imageMessage`, se analiza con `OpenAI Analizar Imagen`;
- video: `videoMessage`, queda como no soportado por ahora y responde pidiendo texto, audio o foto;
- otros documentos/stickers: no soportados por ahora;
- confirmaciones:
   - Si el mensaje es `si`, `confirmo`, `ok`, `dale`, `confirmar`, ejecuta la accion pendiente.
   - Si es `no`, `cancelar`, `anular`, borra la accion pendiente.

## Reglas de confirmacion

Toda accion que modifique datos requiere confirmacion:

- `create_transaction`
- `update_transaction`
- `delete_transaction`

El primer llamado se hace asi:

```json
{
  "sourcePhone": "549XXXXXXXXXX",
  "action": "create_transaction",
  "confirmed": false,
  "payload": {
    "amount": 12500,
    "type": "EXPENSE",
    "date": "2026-05-30",
    "description": "Supermercado",
    "categoryName": "Alimentos",
    "status": "PAID"
  }
}
```

La app respondera `requiresConfirmation:true`. n8n guarda ese payload y pregunta:

```text
Confirmo?
Gasto: $12.500
Fecha: 30/05/2026
Categoria: Alimentos
Detalle: Supermercado

Responde SI para cargarlo o NO para cancelar.
```

Si respondes `SI`, n8n reenvia el mismo payload con:

```json
{ "confirmed": true }
```

## Manejo de texto

Ejemplos que debe entender:

```text
gaste 12500 en supermercado hoy
cargar gasto de 8300 farmacia ayer pagado
ingreso 350000 alquiler 5 de mayo
cuanto gaste este mes?
busca gastos de luz de mayo
borra el gasto de telefono del 17/5
```

## Manejo de audio

Audio recomendado:

```text
"Cargame un gasto de doce mil quinientos en supermercado para hoy, categoria alimentos"
```

Pasos:

1. Evolution API entrega evento con media.
2. n8n descarga el audio.
3. n8n transcribe.
4. El texto transcripto entra al mismo agente.

Si la transcripcion tiene baja confianza o falta monto/categoria/fecha:

```text
Me falta un dato para cargarlo. Entendi: gasto en supermercado. Que monto cargo?
```

## Manejo de imagenes

Sirve para tickets, comprobantes o capturas.

El agente debe extraer:

- monto total;
- fecha;
- comercio o descripcion;
- posible categoria;
- si parece pago realizado o pendiente;
- moneda si aparece.

Si hay varios montos, debe priorizar `TOTAL`, `Importe total`, `Total a pagar`, `Pagado` o equivalente.

Si la imagen tiene datos sensibles, n8n no deberia persistirla salvo que vos lo configures explicitamente.

## Payloads hacia la app

### Crear gasto

```json
{
  "action": "create_transaction",
  "confirmed": false,
  "payload": {
    "amount": 12500,
    "type": "EXPENSE",
    "date": "2026-05-30",
    "description": "Supermercado",
    "categoryName": "Alimentos",
    "accountName": "Efectivo",
    "status": "PAID",
    "createMissingCategory": false
  }
}
```

### Crear ingreso

```json
{
  "action": "create_transaction",
  "confirmed": false,
  "payload": {
    "amount": 350000,
    "type": "INCOME",
    "date": "2026-05-30",
    "description": "Alquiler",
    "categoryName": "Alquileres",
    "status": "PAID"
  }
}
```

### Consultar resumen

```json
{
  "action": "summary",
  "payload": {
    "month": 5,
    "year": 2026
  }
}
```

### Buscar movimientos

```json
{
  "action": "search_transactions",
  "payload": {
    "query": "telefono",
    "type": "EXPENSE",
    "startDate": "2026-05-01",
    "endDate": "2026-05-31",
    "limit": 10
  }
}
```

## Recomendaciones de seguridad

- Activar `ASSISTANT_ALLOWED_PHONE`.
- No permitir `createMissingCategory:true` por defecto.
- Guardar confirmaciones pendientes con vencimiento de 10 minutos.
- Deduplicar `messageId`.
- Nunca ejecutar borrados sin mostrar primero el movimiento encontrado.
- Registrar en n8n una auditoria minima: telefono, accion, fecha, resultado, no el contenido completo de imagen/audio.
