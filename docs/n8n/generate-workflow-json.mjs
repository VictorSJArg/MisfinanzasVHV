import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const systemPrompt = readFileSync(join(here, 'finanzas-agent-system-prompt.md'), 'utf8').trim();

const openAiCredential = {
  openAiApi: {
    id: 'iBtavsUjKSNmDbhi',
    name: 'OpenAi account'
  }
};

const configDefaults = {
  APP_BASE_URL: 'COMPLETAR_URL_PUBLICA_DE_LA_APP',
  ASSISTANT_WEBHOOK_SECRET: 'COMPLETAR_TOKEN_COMPARTIDO_CON_LA_APP',
  ASSISTANT_ALLOWED_PHONE: 'COMPLETAR_NUMERO_WHATSAPP_SOLO_DIGITOS',
  DEFAULT_ACCOUNT_NAME: 'Efectivo',
  EVOLUTION_BASE_URL: '',
  EVOLUTION_INSTANCE: '',
  EVOLUTION_API_KEY: ''
};

function id(seed) {
  return seed;
}

function boolIf(leftValue) {
  return {
    conditions: {
      options: {
        caseSensitive: true,
        leftValue: '',
        typeValidation: 'strict',
        version: 2
      },
      conditions: [
        {
          id: cryptoId(),
          leftValue,
          rightValue: '',
          operator: {
            type: 'boolean',
            operation: 'true',
            singleValue: true
          }
        }
      ],
      combinator: 'and'
    },
    options: {}
  };
}

let cryptoCounter = 0;
function cryptoId() {
  cryptoCounter += 1;
  return `00000000-0000-4000-8000-${String(cryptoCounter).padStart(12, '0')}`;
}

const normalizeEvolutionCode = `function normalizePhone(value) {
  return String(value || '').replace(/[^\\d]/g, '');
}

function textFromMessage(message, fallbackText) {
  return String(
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    fallbackText ||
    ''
  ).trim();
}

function detectMessageType(data, message, fallbackType) {
  if (fallbackType) return fallbackType;
  if (data?.messageType) return data.messageType;
  if (message?.conversation) return 'conversation';
  if (message?.extendedTextMessage) return 'extendedTextMessage';
  if (message?.audioMessage) return 'audioMessage';
  if (message?.imageMessage) return 'imageMessage';
  if (message?.videoMessage) return 'videoMessage';
  if (message?.documentMessage) return 'documentMessage';
  return 'conversation';
}

function routeFromMessageType(messageType, text) {
  if (['conversation', 'extendedTextMessage'].includes(messageType)) return 'text';
  if (messageType === 'audioMessage') return 'audio';
  if (messageType === 'imageMessage') return 'image';
  if (messageType === 'videoMessage') return 'video';
  if (text) return 'text';
  return 'unsupported';
}

let triggerData = {};
try {
  triggerData = $('Webhook1').item.json;
} catch (e) {
  triggerData = $json;
}

const config = $json;
const body = triggerData.body || triggerData;
const data = body.data || body;
const key = data.key || {};
const message = data.message || {};

const allowedPhones = String(config.ASSISTANT_ALLOWED_PHONE || '').split(',').map(normalizePhone).filter(Boolean);
const isChatTrigger = !!(body.sessionId || body.chatInput);

const messageType = detectMessageType(data, message, body.messageType);
const text = textFromMessage(message, body.text || body.chatInput);

const remoteJid = key.remoteJid || data.remoteJid || body.remoteJid || body.replyNumber || '';
const sender = body.sender || data.sender || remoteJid || body.phone || '';
const isLid = String(remoteJid).includes('@lid');
const senderPhone = normalizePhone(sender);
const remotePhone = normalizePhone(String(remoteJid).replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', ''));
const phone = body.phone ? normalizePhone(body.phone) : (isLid && senderPhone ? senderPhone : remotePhone) || (isChatTrigger && allowedPhones[0] ? allowedPhones[0] : '') || '5491122334455';
const replyNumber = body.replyNumber || (isLid && senderPhone ? \`\${senderPhone}@s.whatsapp.net\` : remoteJid) || (phone ? \`\${phone}@s.whatsapp.net\` : '');

const mediaUrl = message.mediaUrl || data.mediaUrl || message.audioMessage?.url || message.imageMessage?.url || message.videoMessage?.url || body.mediaUrl || '';
const routeType = routeFromMessageType(messageType, text);
const fromMe = key.fromMe === true || body.fromMe === true;
const source = data.source || body.source || (isChatTrigger ? 'chat' : 'test');

return [{
  json: {
    data: {
      remoteJid,
      replyNumber,
      phone,
      fromMe,
      id: key.id || data.messageId || body.messageId || body.id || \`test-\${Date.now()}\`,
      messageType,
      routeType,
      text,
      mediaUrl,
      source
    },
    evolution: {
      serverUrl: body.server_url || body.serverUrl || config.EVOLUTION_BASE_URL || '',
      instance: body.instance || config.EVOLUTION_INSTANCE || '',
      apiKey: body.apikey || body.apiKey || config.EVOLUTION_API_KEY || ''
    },
    authorized: allowedPhones.length === 0 || allowedPhones.includes(phone)
  },
  binary: $input.first()?.binary || {}
}];`;


const confirmationRouterCode = `function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

const requestJson = async ({ method = 'GET', url, headers = {}, body }) => {
  try {
    const response = await this.helpers.httpRequest({
      method,
      url,
      headers,
      body,
      json: true
    });
    return { ok: true, status: 200, data: response };
  } catch (error) {
    const status = error.httpCode || (error.response && error.response.status) || 500;
    let responseData = error.error;
    if (!responseData && error.response) {
      responseData = error.response.data || error.response.body;
    }
    if (!responseData) {
      responseData = { message: error.message };
    }
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        responseData = { raw: responseData };
      }
    }
    return { ok: false, status, data: responseData };
  }
};

const item = $json;
const staticData = $getWorkflowStaticData('global');
staticData.processedMessageIds ||= {};

const messageId = item.data.id;
if (messageId && staticData.processedMessageIds[messageId]) {
  return [{ json: { ...item, shouldContinue: false, shouldSend: false, duplicate: true } }];
}
if (messageId) staticData.processedMessageIds[messageId] = Date.now();

for (const [id, ts] of Object.entries(staticData.processedMessageIds)) {
  if (Number(ts) < Date.now() - 24 * 60 * 60 * 1000) delete staticData.processedMessageIds[id];
}

if (!item.authorized) {
  return [{ json: { ...item, shouldContinue: false, shouldSend: false, ignored: true, reason: 'phone_not_allowed' } }];
}

const config = $('Config').first().json;
const appResponse = await requestJson({
  method: 'POST',
  url: \`\${String(config.APP_BASE_URL || '').replace(/\\/$/, '')}/api/assistant\`,
  headers: { Authorization: \`Bearer \${config.ASSISTANT_WEBHOOK_SECRET}\` },
  body: {
    sourcePhone: item.data.phone,
    action: 'confirm',
    payload: {
      text: item.data.text
    }
  }
});

if (appResponse.ok && appResponse.data?.processed === true) {
  return [{
    json: {
      ...item,
      shouldContinue: false,
      shouldSend: true,
      replyText: appResponse.data.reply,
      appResponse: appResponse.data
    }
  }];
}

return [{ json: { ...item, shouldContinue: true, shouldSend: false } }];`;

const prepareTextInputCode = `return [{
  json: {
    ...$json,
    source: 'text',
    normalizedInput: $json.data.text
  }
}];`;

const prepareAudioInputCode = `const base = $('Router Confirmaciones').item.json;
return [{
  json: {
    ...base,
    source: 'audio',
    normalizedInput: \`Transcripción de audio: \${$json.text || ''}\`.trim()
  }
}];`;

const prepareImageInputCode = `const base = $('Router Confirmaciones').item.json;
const imageText = $json.content || $json.message?.content || '';
const caption = base.data.text ? \`Texto/caption enviado por el usuario: \${base.data.text}\\n\\n\` : '';
return [{
  json: {
    ...base,
    source: 'image',
    normalizedInput: \`\${caption}Análisis de imagen/comprobante: \${imageText}\`.trim()
  }
}];`;

const unsupportedInputCode = `const type = $json.data?.messageType || 'desconocido';
const replyText = type === 'videoMessage'
  ? 'Por ahora no proceso videos. Mandame texto, audio o una foto del comprobante y lo cargo.'
  : 'Por ahora solo proceso texto, audio e imágenes. Mandame el gasto o ingreso en alguno de esos formatos.';
return [{ json: { ...$json, shouldContinue: false, shouldSend: true, replyText } }];`;

const prepareAgentPromptCode = `const requestJson = async ({ method = 'GET', url, headers = {}, body }) => {
  try {
    const response = await this.helpers.httpRequest({
      method,
      url,
      headers,
      body,
      json: true
    });
    return { ok: true, status: 200, data: response };
  } catch (error) {
    const status = error.httpCode || (error.response && error.response.status) || 500;
    let responseData = error.error;
    if (!responseData && error.response) {
      responseData = error.response.data || error.response.body;
    }
    if (!responseData) {
      responseData = { message: error.message };
    }
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        responseData = { raw: responseData };
      }
    }
    return { ok: false, status, data: responseData };
  }
};

function todayArgentina() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
}

const config = $('Config').first().json;
const item = $json;
const metadata = await requestJson({
  method: 'POST',
  url: \`\${String(config.APP_BASE_URL || '').replace(/\\/$/, '')}/api/assistant\`,
  headers: { Authorization: \`Bearer \${config.ASSISTANT_WEBHOOK_SECRET}\` },
  body: {
    sourcePhone: item.data.phone,
    action: 'metadata',
    payload: {
      text: item.normalizedInput
    },
    confirmed: false
  }
});

if (!metadata.ok) {
  return [{
    json: {
      ...item,
      shouldUseOpenAI: false,
      shouldSend: true,
      replyText: \`No pude leer categorías/cuentas desde la app: \${metadata.data?.error || metadata.status}\`
    }
  }];
}

const agentInput = {
  message: item.normalizedInput,
  source: item.source,
  context: {
    today: todayArgentina(),
    phone: item.data.phone,
    defaultAccountName: config.DEFAULT_ACCOUNT_NAME || 'Efectivo',
    categories: metadata.data?.data?.categories || [],
    accounts: metadata.data?.data?.accounts || [],
    chatHistory: metadata.data?.data?.chatHistory || []
  }
};

return [{
  json: {
    ...item,
    shouldUseOpenAI: true,
    agentPrompt: JSON.stringify(agentInput)
  }
}];`;

const executeAssistantCode = `function money(value) {
  const number = Number(value || 0);
  return \`$\${number.toLocaleString('es-AR', { maximumFractionDigits: 2 })}\`;
}

function confirmationText(payload, appPreview) {
  const preview = appPreview || payload || {};
  if (preview.count && preview.transactions) {
    const type = preview.type === 'INCOME' ? 'ingresos' : 'gastos';
    const list = preview.transactions.map((t) => {
      const d = t.date ? t.date.split('T')[0] : '';
      return \`• \${d}: \${money(t.amount)}\${t.description ? \` - \${t.description}\` : ''}\`;
    }).join('\\n');
    return [
      \`Confirmo la carga de \${preview.count} \${type} por un total de \${money(preview.totalAmount)}?\`,
      list,
      '',
      'Respondé SI para confirmar o NO para cancelar.'
    ].filter(Boolean).join('\\n');
  }
  const type = preview.type === 'INCOME' ? 'ingreso' : 'gasto';
  return [
    \`Confirmo \${type}\${preview.amount ? \` de \${money(preview.amount)}\` : ''}?\`,
    preview.date ? \`Fecha: \${preview.date}\` : '',
    preview.categoryName || preview.category ? \`Categoría: \${preview.categoryName || preview.category}\` : '',
    preview.accountName ? \`Cuenta: \${preview.accountName}\` : '',
    preview.description ? \`Detalle: \${preview.description}\` : '',
    '',
    'Respondé SI para confirmar o NO para cancelar.'
  ].filter(Boolean).join('\\n');
}

const requestJson = async ({ method = 'GET', url, headers = {}, body }) => {
  try {
    const response = await this.helpers.httpRequest({
      method,
      url,
      headers,
      body,
      json: true
    });
    return { ok: true, status: 200, data: response };
  } catch (error) {
    const status = error.httpCode || (error.response && error.response.status) || 500;
    let responseData = error.error;
    if (!responseData && error.response) {
      responseData = error.response.data || error.response.body;
    }
    if (!responseData) {
      responseData = { message: error.message };
    }
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        responseData = { raw: responseData };
      }
    }
    return { ok: false, status, data: responseData };
  }
};

const base = $('Preparar Prompt Finanzas').item.json;
const config = $('Config').first().json;
let agentOutput = $json.message?.content || $json.content || $json;
if (typeof agentOutput === 'string') {
  try { agentOutput = JSON.parse(agentOutput); } catch {
    return [{ json: { ...base, shouldSend: true, replyText: 'No pude interpretar la respuesta del modelo como JSON.' } }];
  }
}

if (agentOutput.intent === 'clarification' || agentOutput.intent === 'unsupported') {
  const replyText = agentOutput.reply || 'Necesito un dato más para avanzar.';
  await requestJson({
    method: 'POST',
    url: \`\${String(config.APP_BASE_URL || '').replace(/\\/$/, '')}/api/assistant\`,
    headers: { Authorization: \`Bearer \${config.ASSISTANT_WEBHOOK_SECRET}\` },
    body: {
      sourcePhone: base.data.phone,
      action: 'log_reply',
      payload: {
        role: 'assistant',
        text: replyText
      }
    }
  });
  return [{ json: { ...base, shouldSend: true, replyText, agentOutput } }];
}

const assistantRequest = agentOutput.assistantRequest || {};
if (!assistantRequest.action) {
  const replyText = agentOutput.reply || 'No pude convertir el pedido en una acción segura.';
  await requestJson({
    method: 'POST',
    url: \`\${String(config.APP_BASE_URL || '').replace(/\\/$/, '')}/api/assistant\`,
    headers: { Authorization: \`Bearer \${config.ASSISTANT_WEBHOOK_SECRET}\` },
    body: {
      sourcePhone: base.data.phone,
      action: 'log_reply',
      payload: {
        role: 'assistant',
        text: replyText
      }
    }
  });
  return [{ json: { ...base, shouldSend: true, replyText, agentOutput } }];
}

const appResponse = await requestJson({
  method: 'POST',
  url: \`\${String(config.APP_BASE_URL || '').replace(/\\/$/, '')}/api/assistant\`,
  headers: { Authorization: \`Bearer \${config.ASSISTANT_WEBHOOK_SECRET}\` },
  body: {
    sourcePhone: base.data.phone,
    action: assistantRequest.action,
    payload: assistantRequest.payload || {},
    confirmed: assistantRequest.confirmed === true
  }
});

const requiresConfirmation = appResponse.status === 409 || appResponse.data?.requiresConfirmation === true;
let replyText;
if (requiresConfirmation) {
  replyText = confirmationText(assistantRequest.payload, appResponse.data?.preview);
} else {
  replyText = appResponse.data?.reply || agentOutput.reply || (appResponse.ok ? 'Listo.' : \`No pude ejecutar: \${appResponse.data?.error || appResponse.status}\`);
}

// Log assistant reply
await requestJson({
  method: 'POST',
  url: \`\${String(config.APP_BASE_URL || '').replace(/\\/$/, '')}/api/assistant\`,
  headers: { Authorization: \`Bearer \${config.ASSISTANT_WEBHOOK_SECRET}\` },
  body: {
    sourcePhone: base.data.phone,
    action: 'log_reply',
    payload: {
      role: 'assistant',
      text: replyText
    }
  }
});

if (requiresConfirmation) {
  return [{
    json: {
      ...base,
      shouldSend: true,
      replyText,
      agentOutput,
      appResponse: appResponse.data
    }
  }];
}

return [{ json: { ...base, shouldSend: true, replyText, agentOutput, appResponse: appResponse.data } }];`;

const splitMessagesCode = `const input = $input.first()?.json || {};
const text = String(input.replyText || '').trim();
const maxLength = 3200;
if (!text) return [];

function splitLongParagraph(paragraph) {
  const chunks = [];
  let rest = paragraph;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf(' ', maxLength);
    if (cut < 500) cut = maxLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function splitText(value) {
  const paragraphs = value.split(/\\n{2,}/);
  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const clean = paragraph.trim();
    if (!clean) continue;
    if (clean.length > maxLength) {
      if (current) chunks.push(current.trim());
      current = '';
      chunks.push(...splitLongParagraph(clean));
      continue;
    }
    const candidate = current ? \`\${current}\\n\\n\${clean}\` : clean;
    if (candidate.length > maxLength) {
      chunks.push(current.trim());
      current = clean;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks.length ? chunks : [value];
}

const chunks = splitText(text);
return chunks.map((splitText, index) => ({
  json: { ...input, splitText, splitIndex: index + 1, splitTotal: chunks.length }
}));`;

const configAssignments = Object.entries(configDefaults).map(([name, value], index) => ({
  id: `cfg-${index + 1}`,
  name,
  value,
  type: 'string'
}));

const stickyNote = [
  'Configurar en el nodo Config:',
  '',
  '- APP_BASE_URL: URL publica de Mis Finanzas',
  '- ASSISTANT_WEBHOOK_SECRET: token compartido con la app',
  '- ASSISTANT_ALLOWED_PHONE: numero autorizado, solo digitos',
  '- DEFAULT_ACCOUNT_NAME: cuenta por defecto si no se indica',
  '- EVOLUTION_BASE_URL / INSTANCE / API_KEY: opcional, solo si Evolution no manda esos datos en el webhook',
  '',
  'OpenAI:',
  'Este flujo usa la credencial existente de n8n: OpenAi account.',
  '',
  'Evolution:',
  'El envio usa body.server_url, body.instance, body.apikey y body.data.key.remoteJid.',
  '',
  'Tipos soportados:',
  '- Texto: conversation / extendedTextMessage',
  '- Audio: audioMessage -> OpenAI Transcribe',
  '- Imagen: imageMessage -> OpenAI Analyze Image',
  '- Video/documentos: respuesta no soportada por ahora'
].join('\n');

const workflow = {
  name: 'Mis Finanzas VHV - WhatsApp Agent',
  nodes: [
    {
      parameters: { content: stickyNote, height: 520, width: 560, color: 4 },
      id: id('8d3f8c5d-8d21-4f5d-8d82-0a0f74a3a1b1'),
      name: 'Notas de configuracion',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-960, -1540]
    },
    {
      parameters: {
        options: {
          title: 'Asistente de Finanzas VHV',
          subtitle: 'Prueba tu agente aquí'
        }
      },
      id: id('a0000000-b000-c000-d000-000000000004'),
      name: 'Chat Trigger',
      type: '@n8n/n8n-nodes-langchain.chatTrigger',
      typeVersion: 1,
      position: [-1280, -1080]
    },
    {
      parameters: {},
      id: id('a0000000-b000-c000-d000-000000000001'),
      name: 'Manual Trigger',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [-1440, -760]
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: 'test-msg-1',
              name: 'text',
              value: 'gaste 12000 en supermercado hoy',
              type: 'string'
            },
            {
              id: 'test-msg-2',
              name: 'phone',
              value: '5491122334455',
              type: 'string'
            },
            {
              id: 'test-msg-3',
              name: 'messageType',
              value: 'conversation',
              type: 'string'
            },
            {
              id: 'test-msg-4',
              name: 'fromMe',
              value: false,
              type: 'boolean'
            }
          ]
        },
        options: {}
      },
      id: id('a0000000-b000-c000-d000-000000000002'),
      name: 'Config de Prueba',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-1200, -760]
    },
    {
      parameters: { httpMethod: 'POST', path: 'mis-finanzas-whatsapp-agent', options: {} },
      id: id('58cfd7e7-bc9e-4b44-bc20-3c7e47ad8d47'),
      name: 'Webhook1',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [-1280, -920],
      webhookId: 'mis-finanzas-whatsapp-agent'
    },
    {
      parameters: { assignments: { assignments: configAssignments }, options: {} },
      id: id('7c8ce1e3-7dd5-4019-92a4-c73a976f29ef'),
      name: 'Config',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [-1040, -920]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: normalizeEvolutionCode },
      id: id('63b06e3e-f34e-45c3-9650-31fa2d7ee112'),
      name: 'Normalizar Entrada',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-800, -920]
    },
    {
      parameters: boolIf('={{ $json.data.fromMe === true }}'),
      id: id('c7300e87-8054-442f-a4fa-e9e4beca4218'),
      name: 'If From Me',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [-560, -920]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: confirmationRouterCode },
      id: id('ab44c062-59a0-46ef-b69e-a9e85e5d3798'),
      name: 'Router Confirmaciones',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-320, -840]
    },
    {
      parameters: boolIf('={{ $json.shouldContinue === true }}'),
      id: id('ae0358a9-b606-46e5-89a6-d2afd40176c2'),
      name: 'If Continuar',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [-80, -840]
    },
    {
      parameters: {
        rules: {
          values: ['text', 'audio', 'image', 'video', 'unsupported'].map((routeType) => ({
            conditions: {
              options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
              conditions: [
                {
                  id: cryptoId(),
                  leftValue: '={{ $json.data.routeType }}',
                  rightValue: routeType,
                  operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' }
                }
              ],
              combinator: 'and'
            },
            renameOutput: true,
            outputKey: routeType
          }))
        },
        options: {}
      },
      id: id('d2f995e2-35f5-4bca-94d2-eed8d389fcf3'),
      name: 'Message Type',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: [180, -940]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: prepareTextInputCode },
      id: id('ffbe2d7c-0cf0-4499-b2aa-590221c8b214'),
      name: 'Preparar Texto',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, -1200]
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: cryptoId(),
              leftValue: '={{ $json.data.mediaUrl }}',
              rightValue: '',
              operator: { type: 'string', operation: 'notEmpty', singleValue: true }
            }
          ],
          combinator: 'and'
        },
        options: {}
      },
      id: id('a0000000-b000-c000-d000-000000000006'),
      name: 'If Has Audio URL',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [480, -1000]
    },
    {
      parameters: { url: '={{ $json.data.mediaUrl }}', options: {} },
      id: id('e3b450cb-4280-4d1a-9f29-1b84e29cb932'),
      name: 'Get Audio',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [720, -1060]
    },
    {
      parameters: { resource: 'audio', operation: 'transcribe', options: { language: 'es' } },
      id: id('9e3e1120-896b-4a02-a72e-c7afc6243d55'),
      name: 'OpenAI Transcribe Audio',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 1.7,
      position: [960, -1000],
      credentials: openAiCredential
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: prepareAudioInputCode },
      id: id('ff44c22e-30b1-46fb-8295-558e1e693d1c'),
      name: 'Preparar Audio',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1200, -1000]
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [
            {
              id: cryptoId(),
              leftValue: '={{ $json.data.mediaUrl }}',
              rightValue: '',
              operator: { type: 'string', operation: 'notEmpty', singleValue: true }
            }
          ],
          combinator: 'and'
        },
        options: {}
      },
      id: id('a0000000-b000-c000-d000-000000000007'),
      name: 'If Has Image URL',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [480, -800]
    },
    {
      parameters: { url: '={{ $json.data.mediaUrl }}', options: {} },
      id: id('a0000000-b000-c000-d000-000000000008'),
      name: 'Get Image',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [720, -860]
    },
    {
      parameters: {
        resource: 'image',
        operation: 'analyze',
        modelId: { __rl: true, value: 'gpt-4o-mini', mode: 'list', cachedResultName: 'GPT-4O-MINI' },
        text: 'Extraé los datos financieros visibles del comprobante o imagen: comercio, fecha, monto total, moneda, rubro probable y cualquier detalle útil. Si no hay comprobante claro, describí brevemente la imagen.',
        imageInputType: 'binary',
        binaryPropertyName: 'data',
        options: { detail: 'auto', maxTokens: 500 }
      },
      id: id('0c2623a2-6ab1-412e-84e6-392be6d9904c'),
      name: 'OpenAI Analizar Imagen',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 1.7,
      position: [960, -800],
      credentials: openAiCredential
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: prepareImageInputCode },
      id: id('20e4d9a0-669b-4fd9-8b6f-80d6129d4ab7'),
      name: 'Preparar Imagen',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1200, -800]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: unsupportedInputCode },
      id: id('69f102c4-0f7c-4e90-999d-fde035da7f07'),
      name: 'Video o No Soportado',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [480, -600]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: prepareAgentPromptCode },
      id: id('266fa105-5f67-46e8-b8fd-e74715228b65'),
      name: 'Preparar Prompt Finanzas',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1440, -1000]
    },
    {
      parameters: boolIf('={{ $json.shouldUseOpenAI === true }}'),
      id: id('313e6a5c-2f05-4751-9c17-63fab27382ac'),
      name: 'If Usar OpenAI',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [1680, -1000]
    },
    {
      parameters: {
        resource: 'text',
        operation: 'message',
        modelId: { __rl: true, value: 'gpt-4o-mini', mode: 'list', cachedResultName: 'gpt-4o-mini' },
        messages: {
          values: [
            { content: systemPrompt, role: 'system' },
            { content: '={{ $json.agentPrompt }}', role: 'user' }
          ]
        },
        simplify: true,
        jsonOutput: true,
        options: { temperature: 0, maxTokens: 1200 }
      },
      id: id('d699fe80-6cb6-4460-9bc5-d6d884e1d7d7'),
      name: 'OpenAI Interpretar Pedido',
      type: '@n8n/n8n-nodes-langchain.openAi',
      typeVersion: 1.8,
      position: [1920, -1080],
      credentials: openAiCredential
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: executeAssistantCode },
      id: id('bc40a7f8-c780-4559-bf7f-93504d7b0f14'),
      name: 'Ejecutar Solicitud App',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2160, -1080]
    },
    {
      parameters: boolIf('={{ $json.shouldSend === true }}'),
      id: id('d2b929c4-3f9e-4567-973a-b387c8708eee'),
      name: 'If Enviar Respuesta',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [2400, -940]
    },
    {
      parameters: { mode: 'runOnceForAllItems', jsCode: splitMessagesCode },
      id: id('177e975e-e529-4970-a67e-5b0145127c2d'),
      name: 'Split Messages',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2640, -1020]
    },
    {
      parameters: { options: {} },
      id: id('ddbb1a63-5838-420b-aed8-3d3ba7a86343'),
      name: 'Loop Messages',
      type: 'n8n-nodes-base.splitInBatches',
      typeVersion: 3,
      position: [2880, -1020]
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 2
          },
          conditions: [
            {
              id: cryptoId(),
              leftValue: '={{ $json.evolution.serverUrl }}',
              rightValue: '',
              operator: {
                type: 'string',
                operation: 'notEmpty',
                singleValue: true
              }
            }
          ],
          combinator: 'and'
        },
        options: {}
      },
      id: id('a0000000-b000-c000-d000-000000000003'),
      name: 'If Enviar a Evolution',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.2,
      position: [3120, -1020]
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ $json.evolution.serverUrl }}/message/sendText/{{ $json.evolution.instance }}',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'apikey', value: '={{ $json.evolution.apiKey }}' }] },
        sendBody: true,
        bodyParameters: {
          parameters: [
            { name: 'number', value: '={{ $json.data.replyNumber }}' },
            { name: 'text', value: '={{ $json.splitText }}' },
            { name: 'delay', value: '={{ 2000 }}' }
          ]
        },
        options: { redirect: { redirect: {} } }
      },
      id: id('a2036d03-d824-4769-a39c-c93ec7601ed4'),
      name: 'Send Text',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [3400, -1140]
    },
    {
      parameters: { amount: 2 },
      id: id('a46e2168-4bee-423f-87be-3863b73cf36a'),
      name: 'Wait 2s',
      type: 'n8n-nodes-base.wait',
      typeVersion: 1.1,
      position: [3440, -1140],
      webhookId: 'wait-mis-finanzas-whatsapp-agent'
    },
    {
      parameters: {
        assignments: {
          assignments: [
            {
              id: 'chat-resp-1',
              name: 'output',
              value: '={{ $(\'If Enviar Respuesta\').item.json.replyText }}',
              type: 'string'
            }
          ]
        },
        options: {}
      },
      id: id('a0000000-b000-c000-d000-000000000005'),
      name: 'Chat Response',
      type: 'n8n-nodes-base.set',
      typeVersion: 3.4,
      position: [2920, -840]
    }
  ],
  pinData: {},
  connections: {
    Webhook1: { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
    'Chat Trigger': { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
    Config: { main: [[{ node: 'Normalizar Entrada', type: 'main', index: 0 }]] },
    'Normalizar Entrada': { main: [[{ node: 'If From Me', type: 'main', index: 0 }]] },
    'If From Me': { main: [[], [{ node: 'Router Confirmaciones', type: 'main', index: 0 }]] },
    'Router Confirmaciones': { main: [[{ node: 'If Continuar', type: 'main', index: 0 }]] },
    'If Continuar': { main: [[{ node: 'Message Type', type: 'main', index: 0 }], [{ node: 'If Enviar Respuesta', type: 'main', index: 0 }]] },
    'Message Type': {
      main: [
        [{ node: 'Preparar Texto', type: 'main', index: 0 }],
        [{ node: 'If Has Audio URL', type: 'main', index: 0 }],
        [{ node: 'If Has Image URL', type: 'main', index: 0 }],
        [{ node: 'Video o No Soportado', type: 'main', index: 0 }],
        [{ node: 'Video o No Soportado', type: 'main', index: 0 }]
      ]
    },
    'Preparar Texto': { main: [[{ node: 'Preparar Prompt Finanzas', type: 'main', index: 0 }]] },
    'If Has Audio URL': {
      main: [
        [{ node: 'Get Audio', type: 'main', index: 0 }],
        [{ node: 'OpenAI Transcribe Audio', type: 'main', index: 0 }]
      ]
    },
    'Get Audio': { main: [[{ node: 'OpenAI Transcribe Audio', type: 'main', index: 0 }]] },
    'OpenAI Transcribe Audio': { main: [[{ node: 'Preparar Audio', type: 'main', index: 0 }]] },
    'Preparar Audio': { main: [[{ node: 'Preparar Prompt Finanzas', type: 'main', index: 0 }]] },
    'If Has Image URL': {
      main: [
        [{ node: 'Get Image', type: 'main', index: 0 }],
        [{ node: 'OpenAI Analizar Imagen', type: 'main', index: 0 }]
      ]
    },
    'Get Image': { main: [[{ node: 'OpenAI Analizar Imagen', type: 'main', index: 0 }]] },
    'OpenAI Analizar Imagen': { main: [[{ node: 'Preparar Imagen', type: 'main', index: 0 }]] },
    'Preparar Imagen': { main: [[{ node: 'Preparar Prompt Finanzas', type: 'main', index: 0 }]] },
    'Video o No Soportado': { main: [[{ node: 'If Enviar Respuesta', type: 'main', index: 0 }]] },
    'Preparar Prompt Finanzas': { main: [[{ node: 'If Usar OpenAI', type: 'main', index: 0 }]] },
    'If Usar OpenAI': { main: [[{ node: 'OpenAI Interpretar Pedido', type: 'main', index: 0 }], [{ node: 'If Enviar Respuesta', type: 'main', index: 0 }]] },
    'OpenAI Interpretar Pedido': { main: [[{ node: 'Ejecutar Solicitud App', type: 'main', index: 0 }]] },
    'Ejecutar Solicitud App': { main: [[{ node: 'If Enviar Respuesta', type: 'main', index: 0 }]] },
    'Manual Trigger': { main: [[{ node: 'Config de Prueba', type: 'main', index: 0 }]] },
    'Config de Prueba': { main: [[{ node: 'Config', type: 'main', index: 0 }]] },
    'If Enviar Respuesta': { main: [[{ node: 'Split Messages', type: 'main', index: 0 }], []] },
    'Split Messages': { main: [[{ node: 'Loop Messages', type: 'main', index: 0 }]] },
    'Loop Messages': {
      main: [
        [{ node: 'Chat Response', type: 'main', index: 0 }],
        [{ node: 'If Enviar a Evolution', type: 'main', index: 0 }]
      ]
    },
    'If Enviar a Evolution': {
      main: [
        [{ node: 'Send Text', type: 'main', index: 0 }],
        [{ node: 'Loop Messages', type: 'main', index: 0 }]
      ]
    },
    'Send Text': { main: [[{ node: 'Wait 2s', type: 'main', index: 0 }]] },
    'Wait 2s': { main: [[{ node: 'Loop Messages', type: 'main', index: 0 }]] },
    'Chat Response': { main: [] }
  },
  active: false,
  settings: { executionOrder: 'v1', timezone: 'America/Argentina/Buenos_Aires' },
  versionId: '2',
  meta: { templateCredsSetupCompleted: true },
  tags: []
};

const outputPath = join(here, 'mis-finanzas-whatsapp-agent.workflow.json');
writeFileSync(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(`Workflow generado: ${outputPath}`);
