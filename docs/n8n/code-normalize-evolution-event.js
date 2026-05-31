// n8n Code node: Normalize Evolution Event
// Input esperado: webhook recibido desde Evolution API.

const body = $json.body || $json;
const data = body.data || body;
const key = data.key || body.key || {};
const message = data.message || body.message || {};

const remoteJid = key.remoteJid || data.remoteJid || body.remoteJid || '';
const phone = String(remoteJid || data.from || body.from || '')
  .replace('@s.whatsapp.net', '')
  .replace('@c.us', '')
  .replace(/[^\d]/g, '');

const messageId = key.id || data.messageId || body.messageId || body.id || '';

const text =
  message.conversation ||
  message.extendedTextMessage?.text ||
  data.text ||
  body.text ||
  '';

const imageMessage = message.imageMessage || data.imageMessage || null;
const audioMessage = message.audioMessage || data.audioMessage || null;
const documentMessage = message.documentMessage || data.documentMessage || null;

let messageType = 'text';
if (audioMessage) messageType = 'audio';
if (imageMessage || documentMessage?.mimetype?.startsWith('image/')) messageType = 'image';

const staticData = $getWorkflowStaticData('global');
staticData.processedMessageIds ||= {};

if (messageId && staticData.processedMessageIds[messageId]) {
  return [{
    json: {
      duplicate: true,
      messageId,
      phone,
      text: '',
      messageType
    }
  }];
}

if (messageId) {
  staticData.processedMessageIds[messageId] = Date.now();
}

// Limpieza simple para que la memoria estatica no crezca sin limite.
const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
for (const [id, ts] of Object.entries(staticData.processedMessageIds)) {
  if (Number(ts) < oneDayAgo) delete staticData.processedMessageIds[id];
}

return [{
  json: {
    duplicate: false,
    phone,
    messageId,
    messageType,
    text,
    media: {
      mimetype: imageMessage?.mimetype || audioMessage?.mimetype || documentMessage?.mimetype || null,
      mediaKey: imageMessage?.mediaKey || audioMessage?.mediaKey || documentMessage?.mediaKey || null,
      url: imageMessage?.url || audioMessage?.url || documentMessage?.url || null,
      fileName: imageMessage?.fileName || audioMessage?.fileName || documentMessage?.fileName || null
    },
    raw: body
  }
}];
