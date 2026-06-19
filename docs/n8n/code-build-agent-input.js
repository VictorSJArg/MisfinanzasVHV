// n8n Code node: Build Agent Input
// Entradas esperadas:
// - item normalizado por Evolution.
// - respuesta de metadata de la app en $json.metadata, o adaptar segun nombre del nodo.

const item = $json;
const metadata = item.metadata || item.appMetadata || {};
const data = metadata.data || metadata;

const today = new Date().toLocaleDateString('sv-SE', {
  timeZone: 'America/Argentina/Buenos_Aires'
});

const normalizedText = [
  item.text,
  item.transcript ? `Transcripcion de audio: ${item.transcript}` : '',
  item.ocrText ? `Texto extraido de imagen: ${item.ocrText}` : ''
].filter(Boolean).join('\n\n');

return [{
  json: {
    message: normalizedText,
    source: item.messageType,
    context: {
      today,
      phone: item.phone,
      categories: data.categories || [],
      accounts: data.accounts || [],
      personalContacts: data.personalContacts || [],
      chatHistory: data.chatHistory || [],
      pendingAssistantSession: data.pendingAssistantSession || null,
      pendingConfirmation: item.pendingConfirmation || null
    },
    media: {
      transcript: item.transcript || '',
      ocrText: item.ocrText || ''
    },
    original: item
  }
}];
