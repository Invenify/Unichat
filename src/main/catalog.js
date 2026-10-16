// catalog.js — catalogue des chats IA connus sur le web.
// Purement déclaratif : une entrée = un service activable. Aucun code dédié.
// accent/accent2 : code couleur du service ; logo : URL d'une image (favicon).
// defaultOn : pré-coché lors de l'onboarding (premier lancement).

const S2 = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

const catalog = [
  { name: 'ChatGPT', url: 'https://chatgpt.com', accent: '#10a37f', accent2: '#35c29a', logo: S2('chatgpt.com'), defaultOn: false },
  { name: 'Claude', url: 'https://claude.ai', accent: '#d97757', accent2: '#e8a87c', logo: 'https://claude.ai/favicon.ico', defaultOn: false },
  { name: 'Gemini', url: 'https://gemini.google.com', accent: '#4285f4', accent2: '#9b72cb', logo: S2('gemini.google.com'), defaultOn: false },
  { name: 'Copilot', url: 'https://copilot.microsoft.com', accent: '#0f6cbd', accent2: '#56c2cd', logo: 'https://copilot.microsoft.com/favicon.ico', defaultOn: false },
  { name: 'Perplexity', url: 'https://www.perplexity.ai', accent: '#20808d', accent2: '#52b9c9', logo: 'https://www.perplexity.ai/favicon.svg', defaultOn: false },
  { name: 'Le Chat', url: 'https://chat.mistral.ai', accent: '#fa520f', accent2: '#ff8c42', logo: S2('chat.mistral.ai'), defaultOn: true },
  { name: 'Euria', url: 'https://euria.infomaniak.com', accent: '#0098f7', accent2: '#54c2f9', logo: 'https://euria.infomaniak.com/favicon.ico', blockNavRegex: '^https://ksuite\\.infomaniak\\.com', defaultOn: true },
  { name: 'Lumo', url: 'https://lumo.proton.me', accent: '#6d4aff', accent2: '#a489ff', logo: 'https://lumo.proton.me/favicon.ico', excludeRegex: '/guest', defaultOn: true },
  { name: 'Grok', url: 'https://grok.com', accent: '#1d1d1f', accent2: '#6e6e73', logo: S2('grok.com'), defaultOn: false },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com', accent: '#4d6bfe', accent2: '#7d93ff', logo: 'https://chat.deepseek.com/favicon.ico', defaultOn: false },
  { name: 'HuggingChat', url: 'https://huggingface.co/chat', accent: '#ffd21e', accent2: '#ffe066', logo: 'https://huggingface.co/favicon.ico', defaultOn: false },
  { name: 'Poe', url: 'https://poe.com', accent: '#5b5bd6', accent2: '#8f8ff5', logo: 'https://poe.com/favicon.ico', defaultOn: false },
  { name: 'Qwen', url: 'https://chat.qwen.ai', accent: '#615ced', accent2: '#9d8bff', logo: 'https://chat.qwen.ai/favicon.ico', defaultOn: false },
  { name: 'Kimi', url: 'https://kimi.com', accent: '#6d7ee1', accent2: '#a5b4fc', logo: S2('kimi.com'), defaultOn: false },
  { name: 'Meta AI', url: 'https://www.meta.ai', accent: '#0064e0', accent2: '#4a94e8', logo: 'https://meta.ai/favicon.ico', defaultOn: false },
  { name: 'Character.AI', url: 'https://character.ai', accent: '#3f51b5', accent2: '#7986cb', logo: 'https://character.ai/favicon.ico', defaultOn: false },
  { name: 'You.com', url: 'https://you.com', accent: '#235ce1', accent2: '#5b85f0', logo: 'https://you.com/favicon.ico', defaultOn: false },
  { name: 'Z.ai', url: 'https://chat.z.ai', accent: '#5b6bff', accent2: '#9aa5ff', logo: 'https://chat.z.ai/favicon.ico', defaultOn: false },
  { name: 'Pi', url: 'https://pi.ai', accent: '#7b3ff2', accent2: '#b07cf7', logo: S2('pi.ai'), defaultOn: false },
  { name: 'DiDI', url: 'https://chat.nexio.ovh', accent: '#3aa14d', accent2: '#7bd389', logo: 'https://chat.nexio.ovh/static/favicon.png', defaultOn: true },
];

function list() {
  return catalog;
}

function find(url) {
  return catalog.find((s) => s.url === url) || null;
}

// Même origine (protocole + hôte + port), indépendamment du chemin et des
// paramètres : un service enregistré avec « ?ksuite-mode=main » correspond
// toujours à son entrée du catalogue.
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

module.exports = { list, find, sameOrigin };
