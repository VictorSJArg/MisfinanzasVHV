// n8n Code node: Agente WhatsApp Finanzas VHV
// Este codigo se inserta automaticamente dentro del workflow JSON importable.

const SYSTEM_PROMPT = __SYSTEM_PROMPT__;

function env(name, fallback = '') {
  try {
    if (typeof $env !== 'undefined' && $env[name]) return $env[name];
  } catch {}
  try {
    if (typeof $vars !== 'undefined' && $vars[name]) return $vars[name];
  } catch {}
  try {
    if (globalThis.process?.env?.[name]) return globalThis.process.env[name];
  } catch {}
  return fallback;
}

const CONFIG = {
  appBaseUrl: env('APP_BASE_URL', 'https://TU_APP.vercel.app'),
  assistantSecret: env('ASSISTANT_WEBHOOK_SECRET', 'CAMBIAR_ASSISTANT_WEBHOOK_SECRET'),
  allowedPhone: env('ASSISTANT_ALLOWED_PHONE', ''),
  evolutionBaseUrl: env('EVOLUTION_BASE_URL', 'https://TU_EVOLUTION_API'),
  evolutionInstance: env('EVOLUTION_INSTANCE', 'TU_INSTANCIA'),
  evolutionApiKey: env('EVOLUTION_API_KEY', 'CAMBIAR_EVOLUTION_API_KEY'),
  openaiApiKey: env('OPENAI_API_KEY', 'CAMBIAR_OPENAI_API_KEY'),
  openaiModel: env('OPENAI_MODEL', 'gpt-4o-mini'),
  openaiTranscriptionModel: env('OPENAI_TRANSCRIPTION_MODEL', 'gpt-4o-mini-transcribe')
};

let CURRENT_EVENT = null;
let OUTGOING_REPLY = null;

function normalizePhone(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function normalizeText(value) {
  return String(value || '').trim();
}

function todayArgentina() {
  return new Date().toLocaleDateString('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires'
  });
}

function money(value) {
  const number = Number(value || 0);
  return `$${number.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

async function requestJson({ method = 'GET', url, headers = {}, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

async function requestOpenAIMultipart({ url, formData }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.openaiApiKey}`
    },
    body: formData
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  };
}

function getStaticData() {
  try {
    return $getWorkflowStaticData('global');
  } catch {
    return {};
  }
}

function currentInputJson() {
  try {
    if (typeof $json !== 'undefined') return $json;
  } catch {}

  try {
    return $input.first().json;
  } catch {}

  return {};
}

function extractEvolutionEvent(input) {
  const body = input.body || input;
  const data = body.data || body;
  const key = data.key || body.key || {};
  const message = data.message || body.message || {};

  const remoteJid = key.remoteJid || data.remoteJid || body.remoteJid || data.from || body.from || '';
  const sender = body.sender || data.sender || remoteJid;
  const senderPhone = normalizePhone(sender);
  const remotePhone = normalizePhone(String(remoteJid).replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', ''));
  const isLid = String(remoteJid).includes('@lid');
  const phone = isLid && senderPhone ? senderPhone : remotePhone;
  const replyNumber = isLid && senderPhone
    ? `${senderPhone}@s.whatsapp.net`
    : (remoteJid || (phone ? `${phone}@s.whatsapp.net` : ''));
  const messageId = key.id || data.messageId || body.messageId || body.id || '';

  const imageMessage = message.imageMessage || data.imageMessage || null;
  const audioMessage = message.audioMessage || data.audioMessage || null;
  const documentMessage = message.documentMessage || data.documentMessage || null;
  const extendedTextMessage = message.extendedTextMessage || null;

  const text = normalizeText(
    message.conversation ||
    extendedTextMessage?.text ||
    imageMessage?.caption ||
    documentMessage?.caption ||
    data.text ||
    body.text ||
    ''
  );

  let messageType = 'text';
  if (audioMessage) messageType = 'audio';
  if (imageMessage || documentMessage?.mimetype?.startsWith('image/')) messageType = 'image';

  return {
    body,
    data,
    key,
    message,
    phone,
    messageId,
    messageType,
    text,
    replyNumber,
    evolution: {
      serverUrl: body.server_url || body.serverUrl || data.server_url || data.serverUrl || CONFIG.evolutionBaseUrl,
      instance: body.instance || data.instance || CONFIG.evolutionInstance,
      apiKey: body.apikey || body.apiKey || data.apikey || data.apiKey || CONFIG.evolutionApiKey
    },
    media: {
      mimetype: imageMessage?.mimetype || audioMessage?.mimetype || documentMessage?.mimetype || null,
      fileName: imageMessage?.fileName || audioMessage?.fileName || documentMessage?.fileName || null,
      url: imageMessage?.url || audioMessage?.url || documentMessage?.url || null,
      mediaKey: imageMessage?.mediaKey || audioMessage?.mediaKey || documentMessage?.mediaKey || null
    }
  };
}

function findBase64(value, depth = 0) {
  if (!value || depth > 5) return null;
  if (typeof value === 'string') {
    const compact = value.replace(/^data:[^;]+;base64,/, '');
    if (compact.length > 200 && /^[A-Za-z0-9+/=\r\n]+$/.test(compact)) return compact;
    return null;
  }
  if (typeof value !== 'object') return null;

  for (const key of ['base64', 'base64Message', 'mediaBase64', 'fileBase64']) {
    if (typeof value[key] === 'string') return value[key].replace(/^data:[^;]+;base64,/, '');
  }

  for (const child of Object.values(value)) {
    const found = findBase64(child, depth + 1);
    if (found) return found;
  }
  return null;
}

async function getMediaBase64(event) {
  const embedded = findBase64(event.body);
  if (embedded) return embedded;

  const evolutionBaseUrl = event.evolution?.serverUrl || CONFIG.evolutionBaseUrl;
  const evolutionInstance = event.evolution?.instance || CONFIG.evolutionInstance;
  const evolutionApiKey = event.evolution?.apiKey || CONFIG.evolutionApiKey;

  if (!evolutionBaseUrl || evolutionBaseUrl.includes('TU_EVOLUTION')) return null;

  const response = await requestJson({
    method: 'POST',
    url: `${evolutionBaseUrl}/chat/getBase64FromMediaMessage/${evolutionInstance}`,
    headers: { apikey: evolutionApiKey },
    body: {
      message: event.message,
      key: event.key
    }
  });

  if (!response.ok) return null;
  return findBase64(response.data);
}

async function transcribeAudio(base64, mimetype = 'audio/ogg') {
  const bytes = Buffer.from(base64, 'base64');
  const extension = mimetype.includes('mpeg') ? 'mp3' : mimetype.includes('wav') ? 'wav' : 'ogg';
  const formData = new FormData();

  formData.append('file', new Blob([bytes], { type: mimetype }), `audio.${extension}`);
  formData.append('model', CONFIG.openaiTranscriptionModel);

  const response = await requestOpenAIMultipart({
    url: 'https://api.openai.com/v1/audio/transcriptions',
    formData
  });

  if (!response.ok) return '';
  return response.data?.text || '';
}

function responseOutputText(response) {
  if (response?.output_text) return response.output_text;

  for (const output of response?.output || []) {
    if (output.type !== 'message') continue;
    for (const content of output.content || []) {
      if (content.type === 'output_text') return content.text;
    }
  }

  return '';
}

async function callOpenAI(agentInput, imageBase64, imageMime) {
  const content = [
    {
      type: 'input_text',
      text: JSON.stringify(agentInput)
    }
  ];

  if (imageBase64) {
    content.push({
      type: 'input_image',
      image_url: `data:${imageMime || 'image/jpeg'};base64,${imageBase64}`
    });
  }

  const response = await requestJson({
    method: 'POST',
    url: 'https://api.openai.com/v1/responses',
    headers: {
      Authorization: `Bearer ${CONFIG.openaiApiKey}`
    },
    body: {
      model: CONFIG.openaiModel,
      instructions: SYSTEM_PROMPT,
      input: [
        {
          role: 'user',
          content
        }
      ],
      text: {
        format: {
          type: 'json_object'
        }
      }
    }
  });

  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${JSON.stringify(response.data)}`);
  }

  const outputText = responseOutputText(response.data);
  return JSON.parse(outputText);
}

async function callFinanceApp(sourcePhone, assistantRequest, confirmedOverride) {
  const action = assistantRequest.action;
  const payload = assistantRequest.payload || {};
  const confirmed = confirmedOverride === undefined ? assistantRequest.confirmed === true : confirmedOverride;

  return requestJson({
    method: 'POST',
    url: `${CONFIG.appBaseUrl.replace(/\/$/, '')}/api/assistant`,
    headers: {
      Authorization: `Bearer ${CONFIG.assistantSecret}`
    },
    body: {
      sourcePhone,
      action,
      payload,
      confirmed
    }
  });
}

async function sendWhatsApp(phone, text) {
  if (!phone || !text) return { ok: false, skipped: true };

  OUTGOING_REPLY = {
    shouldSend: true,
    replyText: text,
    replyNumber: CURRENT_EVENT?.replyNumber || phone,
    evolution: CURRENT_EVENT?.evolution || {}
  };

  return { ok: true, queued: true };
}

function result(json) {
  return [{
    json: {
      ...json,
      shouldSend: OUTGOING_REPLY?.shouldSend === true,
      replyText: OUTGOING_REPLY?.replyText || '',
      replyNumber: OUTGOING_REPLY?.replyNumber || CURRENT_EVENT?.replyNumber || '',
      evolution: OUTGOING_REPLY?.evolution || CURRENT_EVENT?.evolution || {}
    }
  }];
}

function confirmationText(payload, appPreview) {
  const preview = appPreview || payload || {};
  const type = preview.type === 'INCOME' ? 'ingreso' : 'gasto';
  return [
    `Confirmo ${type}${preview.amount ? ` de ${money(preview.amount)}` : ''}?`,
    preview.date ? `Fecha: ${preview.date}` : '',
    preview.categoryName || preview.category ? `Categoria: ${preview.categoryName || preview.category}` : '',
    preview.description ? `Detalle: ${preview.description}` : '',
    '',
    'Responde SI para confirmar o NO para cancelar.'
  ].filter(Boolean).join('\n');
}

function cleanupStaticData(staticData) {
  staticData.processedMessageIds ||= {};
  staticData.pendingConfirmations ||= {};

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(staticData.processedMessageIds)) {
    if (Number(ts) < oneDayAgo) delete staticData.processedMessageIds[id];
  }

  for (const [phone, pending] of Object.entries(staticData.pendingConfirmations)) {
    if (!pending?.expiresAt || Date.now() > pending.expiresAt) {
      delete staticData.pendingConfirmations[phone];
    }
  }
}

async function main() {
  OUTGOING_REPLY = null;
  const staticData = getStaticData();
  cleanupStaticData(staticData);

  const event = extractEvolutionEvent(currentInputJson());
  CURRENT_EVENT = event;
  const allowedPhones = CONFIG.allowedPhone
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);

  if (allowedPhones.length > 0 && !allowedPhones.includes(event.phone)) {
    return result({ success: false, ignored: true, reason: 'Phone not allowed', phone: event.phone });
  }

  if (event.messageId && staticData.processedMessageIds[event.messageId]) {
    return result({ success: true, duplicate: true, messageId: event.messageId });
  }
  if (event.messageId) staticData.processedMessageIds[event.messageId] = Date.now();

  const lowerText = event.text.toLowerCase();
  const pending = staticData.pendingConfirmations[event.phone];
  const yes = ['si', 'sí', 'confirmo', 'confirmar', 'ok', 'dale', 'guardar', 'cargar'];
  const no = ['no', 'cancelar', 'cancela', 'anular', 'descartar'];

  if (pending && yes.includes(lowerText)) {
    delete staticData.pendingConfirmations[event.phone];
    const appResponse = await callFinanceApp(event.phone, pending.assistantRequest, true);
    const reply = appResponse.data?.reply || (appResponse.ok ? 'Listo. Accion confirmada.' : `No pude ejecutar: ${appResponse.data?.error || appResponse.status}`);
    await sendWhatsApp(event.phone, reply);
    return result({ success: appResponse.ok, route: 'execute_pending', appResponse: appResponse.data });
  }

  if (pending && no.includes(lowerText)) {
    delete staticData.pendingConfirmations[event.phone];
    const reply = 'Cancelado. No hice cambios.';
    await sendWhatsApp(event.phone, reply);
    return result({ success: true, route: 'cancel_pending', reply });
  }

  let transcript = '';
  let imageBase64 = null;
  let ocrText = '';

  if (event.messageType === 'audio') {
    const audioBase64 = await getMediaBase64(event);
    if (audioBase64) transcript = await transcribeAudio(audioBase64, event.media.mimetype || 'audio/ogg');
  }

  if (event.messageType === 'image') {
    imageBase64 = await getMediaBase64(event);
    ocrText = event.text;
  }

  const metadataResponse = await callFinanceApp(event.phone, { action: 'metadata', payload: {}, confirmed: false }, false);
  if (!metadataResponse.ok) {
    const reply = `No pude leer categorias/cuentas: ${metadataResponse.data?.error || metadataResponse.status}`;
    await sendWhatsApp(event.phone, reply);
    return result({ success: false, route: 'metadata_error', response: metadataResponse.data });
  }

  const normalizedMessage = [
    event.text,
    transcript ? `Transcripcion de audio: ${transcript}` : '',
    ocrText ? `Texto de imagen/caption: ${ocrText}` : ''
  ].filter(Boolean).join('\n\n');

  if (!normalizedMessage && !imageBase64) {
    const reply = 'No pude leer el mensaje. Probame mandando texto, audio claro o una foto legible.';
    await sendWhatsApp(event.phone, reply);
    return result({ success: false, route: 'empty_message', reply });
  }

  const agentInput = {
    message: normalizedMessage,
    source: event.messageType,
    context: {
      today: todayArgentina(),
      phone: event.phone,
      categories: metadataResponse.data?.data?.categories || [],
      accounts: metadataResponse.data?.data?.accounts || []
    },
    media: {
      transcript,
      ocrText
    }
  };

  const agentOutput = await callOpenAI(agentInput, imageBase64, event.media.mimetype || 'image/jpeg');

  if (agentOutput.intent === 'clarification' || agentOutput.intent === 'unsupported') {
    const reply = agentOutput.reply || 'Necesito un dato mas para avanzar.';
    await sendWhatsApp(event.phone, reply);
    return result({ success: true, route: 'clarification', agentOutput });
  }

  const assistantRequest = agentOutput.assistantRequest || {};
  if (!assistantRequest.action) {
    const reply = agentOutput.reply || 'No pude convertir el pedido en una accion segura.';
    await sendWhatsApp(event.phone, reply);
    return result({ success: false, route: 'invalid_agent_output', agentOutput });
  }

  const appResponse = await callFinanceApp(event.phone, assistantRequest, assistantRequest.confirmed === true);
  const requiresConfirmation = appResponse.status === 409 || appResponse.data?.requiresConfirmation === true;

  if (requiresConfirmation) {
    staticData.pendingConfirmations[event.phone] = {
      assistantRequest,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000
    };

    const reply = confirmationText(assistantRequest.payload, appResponse.data?.preview);
    await sendWhatsApp(event.phone, reply);
    return result({ success: true, route: 'pending_confirmation', reply, appResponse: appResponse.data });
  }

  const reply = appResponse.data?.reply || agentOutput.reply || (appResponse.ok ? 'Listo.' : `No pude ejecutar: ${appResponse.data?.error || appResponse.status}`);
  await sendWhatsApp(event.phone, reply);

  return result({
    success: appResponse.ok,
    route: 'completed',
    reply,
    agentOutput,
    appResponse: appResponse.data
  });
}

return await main();
