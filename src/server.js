const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { TimeTrackerStore } = require('./store');

function createApp(customStore) {
  const store = customStore || new TimeTrackerStore();
  const publicDir = path.join(__dirname, '..', 'public');

  function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(body);
  }

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 1e6) {
          reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        }
      });
      req.on('end', () => {
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(Object.assign(new Error('Некорректный JSON'), { statusCode: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      if (req.method === 'GET' && pathname === '/api/employees') {
        return sendJson(res, 200, { employees: store.getEmployees() });
      }

      if (req.method === 'POST' && pathname === '/api/employees') {
        const body = await parseBody(req);
        const employee = store.addEmployee({ name: body.name, role: body.role });
        return sendJson(res, 201, { employee });
      }

      if (req.method === 'POST' && pathname === '/api/timers/start') {
        const body = await parseBody(req);
        const entry = store.startTimer({
          employeeId: body.employeeId,
          task: body.task
        });
        return sendJson(res, 201, { entry });
      }

      if (req.method === 'POST' && pathname === '/api/timers/stop') {
        const body = await parseBody(req);
        const entry = store.stopTimer({
          employeeId: body.employeeId,
          entryId: body.entryId
        });
        return sendJson(res, 200, { entry });
      }

      if (req.method === 'GET' && pathname === '/api/reports') {
        const from = parsedUrl.searchParams.get('from') || undefined;
        const to = parsedUrl.searchParams.get('to') || undefined;
        const employeeId = parsedUrl.searchParams.get('employeeId') || undefined;
        const report = store.getReport({ from, to, employeeId });
        return sendJson(res, 200, report);
      }

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(indexHtml);
      }

      sendJson(res, 404, { error: 'Маршрут не найден' });
    } catch (err) {
      const status = err.statusCode || 500;
      sendJson(res, status, {
        error: err.message || 'Внутренняя ошибка сервера',
        code: err.code || 'ERROR'
      });
    }
  });

  return { server, store };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const { server } = createApp();
  server.listen(PORT, () => {
    console.log(`Falcon Time Tracker запущен: http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
