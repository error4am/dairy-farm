const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { PORT, HOST, CLIENT_DIST, FRONTEND_ORIGINS, AUTH_ENABLED, IS_PRODUCTION } = require('./config');
const db = require('./db');
const { notFound, errorHandler } = require('./middleware/errors');
const { asyncHandler } = require('./middleware/asyncHandler');
const { csrfProtection } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/requireAuth');

if (!db.isPostgres) {
  require('./db/seed')();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

const allowedOrigins = new Set(FRONTEND_ORIGINS);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      return callback(null, allowedOrigins.has(origin));
    },
    credentials: true
  })
);

app.get(
  '/api/health',
  asyncHandler(async (req, res) => {
    const healthy = await db.ping();
    if (!healthy) return res.status(503).json({ status: 'error', database: 'error' });
    res.json({ status: 'ok', database: 'ok' });
  })
);

if (db.isPostgres) {
  app.use(
    asyncHandler(async (req, res, next) => {
      await db.ready();
      next();
    })
  );
}

app.use('/api', csrfProtection);
app.use('/api/auth', require('./routes/auth'));
if (AUTH_ENABLED) {
  app.use('/api', asyncHandler(requireAuth));
}

app.use('/api/animals', require('./routes/animals'));
app.use('/api/health-records', require('./routes/health'));
app.use('/api/breeding-records', require('./routes/breeding'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/employee-payments', require('./routes/employeePayments'));
app.use('/api/inventory-items', require('./routes/inventoryItems'));
app.use('/api/inventory-movements', require('./routes/inventoryMovements'));
app.use('/api/milk-records', require('./routes/milk'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/meta', require('./routes/meta'));

app.use('/api', notFound);

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
}

app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  let server = null;

  async function shutdown() {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
    await db.close().catch(() => {});
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  (async () => {
    try {
      await db.ready();

      if (!db.isPostgres) {
        try {
          const backup = require('./db/backup');
          const result = backup.runAutomaticBackup();
          if (result.skipped) {
            console.log(`Automatic backup: already created today (${result.path})`);
          } else {
            console.log(`Automatic backup created: ${result.path}`);
            if (result.removed.length > 0) {
              console.log(`Removed ${result.removed.length} old automatic backup(s).`);
            }
          }
        } catch (err) {
          console.error(`Automatic backup failed: ${err.message}`);
        }
      }

      server = app.listen(PORT, HOST, () => {
        console.log(`Dairy Farm Manager running at http://${HOST}:${PORT} (${db.dialect})`);
      });
    } catch (err) {
      console.error(`Server failed to start: ${err.message}`);
      process.exit(1);
    }
  })();
}

module.exports = app;
