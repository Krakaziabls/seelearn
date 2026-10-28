import http from 'http';

async function getWsUrl() {
  return new Promise((resolve, reject) => {
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
}

async function run() {
  const wsUrl = await getWsUrl();
  console.log('Connecting to:', wsUrl);

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

  await new Promise((resolve) => (ws.onopen = resolve));

  // 1. Activate SeeLearn study view
  console.log('Activating SeeLearn Study View...');
  await send('Runtime.evaluate', {
    expression: `app.commands.executeCommandById('seelearn:open-study-view')`,
  });

  // Wait 500ms for UI render
  await new Promise((r) => setTimeout(r, 600));

  // 2. Query DOM for help button and old methodology link
  console.log('Inspecting UI components...');
  const domCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const navBar = document.querySelector('.seelearn-nav-bar');
      const helpBtnInNav = document.querySelector('.seelearn-nav-bar .seelearn-nav-help-btn');
      const helpBtnInToolbar = document.querySelector('.seelearn-toolbar .seelearn-nav-help-btn');
      const oldLink = document.querySelector('.seelearn-methodology-link');
      const lobbyBox = document.querySelector('.seelearn-lobby-box');

      let navBarStyles = null;
      let helpBtnStyles = null;
      if (navBar) {
        const computed = window.getComputedStyle(navBar);
        navBarStyles = {
          display: computed.display,
          justifyContent: computed.justifyContent,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight,
        };
      }

      if (helpBtnInNav) {
        const computed = window.getComputedStyle(helpBtnInNav);
        helpBtnStyles = {
          width: computed.width,
          height: computed.height,
          borderRadius: computed.borderRadius,
          display: computed.display,
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          title: helpBtnInNav.getAttribute('title') || helpBtnInNav.getAttribute('aria-label')
        };
      }

      return {
        hasNavBar: !!navBar,
        navBarStyles,
        hasHelpBtnInNav: !!helpBtnInNav,
        hasHelpBtnInToolbar: !!helpBtnInToolbar,
        helpBtnStyles,
        hasOldLink: !!oldLink,
        hasLobbyBox: !!lobbyBox
      };
    })()`,
    returnByValue: true,
  });

  console.log('DOM Check Result:', JSON.stringify(domCheck.result.value, null, 2));

  // 3. Take screenshot
  const screenshotData = await send('Page.captureScreenshot', { format: 'png' });
  if (screenshotData && screenshotData.data) {
    const buffer = Buffer.from(screenshotData.data, 'base64');
    const fs = await import('fs');
    fs.writeFileSync('scratch/obsidian-ui-verification.png', buffer);
    console.log('Screenshot saved to scratch/obsidian-ui-verification.png');
  }

  ws.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
