import http from 'http';
import fs from 'fs';

async function run() {
  const wsUrl = await new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json', (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const pages = JSON.parse(data);
        const page = pages.find((p) => p.type === 'page' && p.url.includes('obsidian.md'));
        if (page) resolve(page.webSocketDebuggerUrl);
        else reject(new Error('No Obsidian page found'));
      });
    }).on('error', reject);
  });

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const msgId = id++;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      resolve(msg.result);
    }
  };

  await new Promise((r) => (ws.onopen = r));

  console.log('Clicking help button to open cheatsheet...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('.seelearn-nav-help-btn');
      if (btn) btn.click();
    })()`,
  });

  await new Promise((r) => setTimeout(r, 600));

  console.log('Capturing screenshot of cheatsheet note in Obsidian...');
  const screenshotData = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratch/obsidian-cheatsheet-rendered.png', Buffer.from(screenshotData.data, 'base64'));
  console.log('Saved to scratch/obsidian-cheatsheet-rendered.png');

  ws.close();
}

run().catch(console.error);
