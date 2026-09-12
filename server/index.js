const fs = require('fs');
const path = require('path');
const express = require('express');
const { PORT, CLIENT_DIST } = require('./config');
const seed = require('./db/seed');
const { notFound, errorHandler } = require('./middleware/errors');

seed();

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/animals', require('./routes/animals'));
app.use('/api/health-records', require('./routes/health'));
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
  app.listen(PORT, () => {
    console.log(`Dairy Farm Manager running at http://localhost:${PORT}`);
  });
}

module.exports = app;
