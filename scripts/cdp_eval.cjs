const http = require('http');
const WebSocket = require('ws');

const HOST = '10.0.0.10';
const PORT = 9998;
const expr = process.argv[2] || '0';
const duration = Number(process.argv[3] || 5) * 1000;

http.get(`http://${HOST}:${PORT}/json/list`, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    const list = JSON.parse(data);
    const page = list.find(x => x.type === 'page');
    if (!page) { console.log(JSON.stringify({ error: 'no page', list })); return; }
    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    const timer = setTimeout(() => { console.log(JSON.stringify({ error: 'timeout' })); ws.close(); process.exit(0); }, duration);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })));
    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      if (msg.id === 1) { clearTimeout(timer); console.log(JSON.stringify(msg.result || msg)); ws.close(); }
    });
    ws.on('error', err => { clearTimeout(timer); console.log(JSON.stringify({ error: String(err) })); process.exit(1); });
  });
});
