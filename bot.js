require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const { TELEGRAM_TOKEN, GEMINI_API_KEY, ALLOWED_USER_IDS } = process.env;

if (!TELEGRAM_TOKEN) throw new Error('TELEGRAM_TOKEN не задан в .env');
if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY не задан в .env');

const allowedIds = (ALLOWED_USER_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
  systemInstruction:
    'Ты — личный помощник пользователя. Отвечай по-русски, кратко и по делу. Помогай анализировать информацию, объяснять, искать решения.',
});

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, model.startChat({ history: [] }));
  }
  return sessions.get(chatId);
}

bot.onText(/^\/start$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    'Привет! Я твой AI-помощник на Gemini.\n\nПросто пиши вопросы — отвечу.\n\n/reset — очистить историю разговора'
  );
});

bot.onText(/^\/reset$/, (msg) => {
  sessions.delete(msg.chat.id);
  bot.sendMessage(msg.chat.id, 'История очищена. Начинаем с чистого листа.');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  if (allowedIds.length > 0 && !allowedIds.includes(userId)) {
    bot.sendMessage(chatId, 'Доступ только для владельца бота.');
    console.log(`Отклонён чужой user_id: ${userId} (${msg.from.username || 'no username'})`);
    return;
  }

  try {
    bot.sendChatAction(chatId, 'typing');
    const chat = getSession(chatId);
    const result = await chat.sendMessage(text);
    const reply = result.response.text();
    await bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error('Gemini error:', err.message);
    bot.sendMessage(chatId, `Ошибка: ${err.message}`);
  }
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

console.log('Бот запущен. Пиши ему в Telegram.');
