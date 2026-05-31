// n8n Code node: Build Evolution Reply
// Ajustar el shape final al endpoint de envio de tu version de Evolution API.

const phone = $json.phone || $json.sourcePhone || $json.original?.phone;
const reply = $json.reply || $json.appResponse?.reply || 'Listo.';

return [{
  json: {
    number: phone,
    text: reply
  }
}];
