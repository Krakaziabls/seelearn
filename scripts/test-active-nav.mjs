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

  // Click start session button
  console.log('Starting session...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('.seelearn-start-session-btn');
      if (btn) btn.click();
    })()`,
  });

  await new Promise((r) => setTimeout(r, 600));

  const domCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const helpBtn = document.querySelector('.seelearn-nav-bar .seelearn-nav-help-btn');
      const centerBtns = Array.from(document.querySelectorAll('.seelearn-nav-group.center button')).map(b => b.textContent.trim());
      const isNavBarVisible = window.getComputedStyle(document.querySelector('.seelearn-nav-bar')).display !== 'none';
      return {
        isNavBarVisible,
        hasHelpBtnInNav: !!helpBtn,
        centerButtons: centerBtns
      };
    })()`,
    returnByValue: true,
  });

  console.log('Active session check:', JSON.stringify(domCheck.result.value, null, 2));

  const screenshotData = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratch/obsidian-active-session.png', Buffer.from(screenshotData.data, 'base64'));
  console.log('Active session screenshot saved to scratch/obsidian-active-session.png');

  // Return to lobby
  await send('Runtime.evaluate', {
    expression: `(() => {
      const view = app.workspace.getActiveViewOfType(app.workspace.getLeavesOfType('seelearn-study-view')[0]?.view?.constructor);
      if (view) {
        view.sessionState = 'lobby';
        view.resetSession();
      }
    })()`,
  });

  ws.close();
}

run().catch(console.error);
