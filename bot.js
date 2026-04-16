require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TELEGRAM_TOKEN = (process.env.TELEGRAM_TOKEN || '').trim();
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const ALLOWED_USER_IDS = (process.env.ALLOWED_USER_IDS || '').trim();

if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_TOKEN не задан в .env');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY не задан в .env');

const allowedIds = ALLOWED_USER_IDS.split(',').map((s) => s.trim()).filter(Boolean).map(Number);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction:
    'Ты — личный помощник пользователя. Отвечай по-русски, кратко и по делу. Помогай анализировать информацию, объяснять, искать решения.',
});

const GROUP_BUFFER_SIZE = 50;
const privateSessions = new Map();
const groupBuffers = new Map();

let botId = null;
let botUsername = null;

bot
  .getMe()
  .then((me) => {
    botId = me.id;
    botUsername = me.username;
    console.log(`Бот @${botUsername} (id=${botId}) запущен`);
  })
  .catch((err) => console.error('getMe error:', err.message));

const getPrivateSession = (chatId) => {
  if (!privateSessions.has(chatId)) {
    privateSessions.set(chatId, model.startChat({ history: [] }));
  }
  return privateSessions.get(chatId);
};

const appendGroupMsg = (chatId, name, text) => {
  if (!groupBuffers.has(chatId)) groupBuffers.set(chatId, []);
  const buf = groupBuffers.get(chatId);
  buf.push({ name, text });
  if (buf.length > GROUP_BUFFER_SIZE) buf.shift();
};

const answerInGroup = async (msg, question) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const name = msg.from.first_name || msg.from.username || 'пользователь';

  if (allowedIds.length && !allowedIds.includes(userId)) return;

  const buffer = groupBuffers.get(chatId) || [];
  const context = buffer.map((m) => `${m.name}: ${m.text}`).join('\n');
  const prompt = `Контекст группового чата (последние ${buffer.length} сообщений):
${context || '(пусто)'}

Вопрос от ${name}: ${question}

Ответь кратко и по делу.`;

  try {
    bot.sendChatAction(chatId, 'typing');
    const result = await model.generateContent(prompt);
    await bot.sendMessage(chatId, result.response.text(), {
      reply_to_message_id: msg.message_id,
    });
  } catch (err) {
    console.error('Gemini error:', err.message);
    bot.sendMessage(chatId, `Ошибка: ${err.message}`);
  }
};

bot.onText(/^\/start(@\w+)?$/, (msg) => {
  const tag = botUsername ? `@${botUsername}` : 'боту';
  bot.sendMessage(
    msg.chat.id,
    `Привет! Я AI-помощник на Gemini.

В личке — просто пиши вопросы.
В группе — зови через ${tag} или команду /ai вопрос.

/reset — очистить историю/контекст`
  );
});

bot.onText(/^\/reset(@\w+)?$/, (msg) => {
  privateSessions.delete(msg.chat.id);
  groupBuffers.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, 'История очищена.');
});

bot.onText(/^\/ai(@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
  if (msg.chat.type === 'private') return;
  const question = (match[2] || '').trim();
  if (!question) {
    bot.sendMessage(msg.chat.id, 'Использование: /ai ваш вопрос');
    return;
  }
  await answerInGroup(msg, question);
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  if (chatType === 'private') {
    if (allowedIds.length && !allowedIds.includes(userId)) {
      bot.sendMessage(chatId, 'Доступ только для владельца бота.');
      return;
    }
    try {
      bot.sendChatAction(chatId, 'typing');
      const session = getPrivateSession(chatId);
      const result = await session.sendMessage(text);
      await bot.sendMessage(chatId, result.response.text());
    } catch (err) {
      console.error('Gemini error:', err.message);
      bot.sendMessage(chatId, `Ошибка: ${err.message}`);
    }
    return;
  }

  const name = msg.from.first_name || msg.from.username || 'кто-то';
  appendGroupMsg(chatId, name, text);

  const mentioned = botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`);
  const repliedToBot = msg.reply_to_message?.from?.id === botId;

  if (!mentioned && !repliedToBot) return;

  let question = text;
  if (botUsername) {
    question = question.replace(new RegExp(`@${botUsername}`, 'gi'), '').trim();
  }
  if (!question) return;

  await answerInGroup(msg, question);
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

console.log('Бот запущен. Пиши ему в Telegram.');
