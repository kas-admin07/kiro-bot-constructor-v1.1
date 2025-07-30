const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware оптимизации производительности
const { apiCacheMiddleware, performanceMiddleware } = require('./utils/OptimizationMiddleware');

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Подключаем middleware оптимизации только для API
app.use('/api/', performanceMiddleware());
app.use('/api/', apiCacheMiddleware());

// Полностью отключаем CSP для разработки
app.use((req, res, next) => {
  // Удаляем все возможные CSP заголовки
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  res.removeHeader('X-Content-Security-Policy');
  res.removeHeader('X-WebKit-CSP');

  // Добавляем заголовки для отключения других ограничений безопасности
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  next();
});

// Настройка MIME типов для ES модулей
app.use('/assets', (req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  } else if (req.path.endsWith('.mjs')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  } else if (req.path.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css');
  }
  next();
});

// Статическая раздача React приложения (приоритет)
app.use(express.static(path.join(__dirname, 'public', 'dist'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));
// Статическая раздача старых файлов (основная)
app.use(express.static(path.join(__dirname, 'public')));
// Статическая раздача старых файлов (для совместимости API)
app.use('/legacy', express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));

// Создание структуры папок для данных
const createDataDirectories = () => {
  const directories = [
    './data',
    './data/users',
    './data/bots',
    './data/templates',
    './data/logs',
    './data/visual_schemas'
  ];

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Создана папка: ${dir}`);
    }
  });
};

// Middleware для обработки ошибок
const errorHandler = (err, req, res, next) => {
  console.error('Ошибка:', err.stack);

  if (err.type === 'validation') {
    return res.status(400).json({
      success: false,
      error: 'Ошибка валидации данных',
      details: err.message
    });
  }

  // Убрана обработка ошибок авторизации - авторизация отключена
  if (false) { // Отключено
    return res.status(401).json({
      success: false,
      error: 'Ошибка авторизации',
      details: err.message
    });
  }

  if (err.type === 'not_found') {
    return res.status(404).json({
      success: false,
      error: 'Ресурс не найден',
      details: err.message
    });
  }

  // Общая ошибка сервера
  res.status(500).json({
    success: false,
    error: 'Внутренняя ошибка сервера',
    details: process.env.NODE_ENV === 'development' ? err.message : 'Что-то пошло не так'
  });
};

// Подключение маршрутов
// ⚠️ АВТОРИЗАЦИЯ ПОЛНОСТЬЮ ОТКЛЮЧЕНА - НЕ ДОБАВЛЯТЬ!
const botsRoutes = require('./routes/bots');
const templatesRoutes = require('./routes/templates');
const visualSchemasRoutes = require('./routes/visual-schemas');
const statsRoutes = require('./routes/stats-no-auth');

const deploymentRoutes = require('./routes/deployment-no-auth');
const { router: webhooksRoutes, setBotRuntime: setWebhookRuntime } = require('./routes/webhooks');
const { router: runtimeRoutes, setBotRuntime: setRuntimeRuntime } = require('./routes/runtime');

// Инициализация среды выполнения ботов
const BotRuntime = require('./utils/BotRuntime');
const botRuntime = new BotRuntime();

// Устанавливаем экземпляр runtime в маршрутах
setWebhookRuntime(botRuntime);
setRuntimeRuntime(botRuntime);

// ⚠️ АВТОРИЗАЦИЯ ОТКЛЮЧЕНА - НЕ ДОБАВЛЯТЬ МАРШРУТЫ AUTH!
app.use('/api/bots', botsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/visual-schemas', visualSchemasRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/performance', require('./routes/performance'));
// app.use('/api/help', require('./routes/help')); // Отключено
app.use('/api/logs', require('./routes/logs'));
app.use('/api/debug', require('./routes/debug'));
app.use('/api/bots', require('./routes/platforms'));
app.use('/api/export', require('./routes/export'));

app.use('/api/deployment', deploymentRoutes);
app.use('/webhook', webhooksRoutes);
app.use('/api/runtime', runtimeRoutes);

// React приложение уже раздается выше как основное

// Dashboard статистика
app.get('/api/stats/dashboard', (req, res) => {
  try {
    // Получаем список всех ботов
    const botsDir = path.join(__dirname, 'data', 'bots');
    let totalBots = 0;
    let activeBots = 0;
    let totalMessages = 0;
    let totalUsers = 0;

    if (fs.existsSync(botsDir)) {
      const botFiles = fs.readdirSync(botsDir).filter(file => file.endsWith('.json'));
      totalBots = botFiles.length;

      botFiles.forEach(file => {
        try {
          const botData = JSON.parse(fs.readFileSync(path.join(botsDir, file), 'utf8'));
          if (botData.status === 'active') {
            activeBots++;
          }
          if (botData.stats) {
            totalMessages += botData.stats.messagesProcessed || 0;
            totalUsers += botData.stats.activeUsers || 0;
          }
        } catch (error) {
          console.error(`Ошибка чтения бота ${file}:`, error);
        }
      });
    }

    res.json({
      totalBots,
      activeBots,
      totalMessages,
      totalUsers
    });
  } catch (error) {
    console.error('Ошибка получения статистики dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Внутренняя ошибка сервера'
    });
  }
});

// API health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Bot Constructor API работает',
    timestamp: new Date().toISOString(),
    version: '1.1.0'
  });
});

// Подключение middleware для обработки ошибок (только для API)
app.use('/api/*', errorHandler);

// Специальные маршруты для отладки
app.get('/debug.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dist', 'debug.html'));
});

app.get('/legacy/*', (req, res, next) => {
  // Уже обработано выше через express.static
  next();
});

// Исключения для тестовых страниц и статических файлов
app.get('/minimal-test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'minimal-test.html'));
});

app.get('/basic-test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'basic-test.html'));
});

app.get('/js-test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'js-test.html'));
});

app.get('/simple-test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'simple-test.html'));
});

app.get('/js-debug.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'js-debug.html'));
});

app.get('/interface-test.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'interface-test.html'));
});

app.get('/index-fixed.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index-fixed.html'));
});

app.get('/old-interface.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/react-debug.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'react-debug.html'));
});

// Главный маршрут - React приложение
app.get('*', (req, res) => {
  // Исключаем API маршруты и статические файлы
  if (req.path.startsWith('/api/') ||
    req.path.startsWith('/assets/') ||
    req.path.includes('.')) {
    return res.status(404).send('Not found');
  }

  // Отправляем React приложение
  res.sendFile(path.join(__dirname, 'public', 'dist', 'index.html'));
});

// Запуск сервера
const startServer = async () => {
  createDataDirectories();

  app.listen(PORT, async () => {
    console.log(`🚀 Bot Constructor запущен на порту ${PORT}`);
    console.log(`📁 Структура данных создана`);
    console.log(`🌐 Откройте http://localhost:${PORT} в браузере`);

    // Загружаем активных ботов
    try {
      const loadedBots = await botRuntime.loadAllBots();
      console.log(`🤖 Среда выполнения готова (${loadedBots} ботов)`);
    } catch (error) {
      console.error('⚠️ Ошибка загрузки ботов:', error.message);
    }
  });
};

// React Router - catch-all для SPA
app.get('*', (req, res) => {
  // Исключаем API роуты
  if (req.path.startsWith('/api/') ||
    req.path.startsWith('/legacy/') ||
    req.path.startsWith('/data/') ||
    req.path.includes('.')) {
    return res.status(404).json({ error: 'Not found' });
  }

  // Отправляем React приложение для всех остальных роутов
  res.sendFile(path.join(__dirname, 'public', 'dist', 'index.html'));
});

startServer();

// Экспортируем функцию для получения экземпляра BotRuntime
function getBotRuntime() {
  return botRuntime;
}

module.exports = { app, getBotRuntime };