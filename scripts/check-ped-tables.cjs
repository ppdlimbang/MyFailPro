// Browser checks use local fixtures only; no real Supabase account or data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'myfailpro-ped-tables-'));
const browserPath = process.env.PED_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(file => fs.existsSync(file));
assert(browserPath, 'Set PED_BROWSER to an installed Chromium browser.');
let scenario = 'office';
const userId = 'preview-user';
const profile = () => ({ id: userId, name: 'Akaun Pratonton', email: 'preview@example.test',
  role: scenario === 'admin' ? 'admin' : 'agency',
  agency_type: scenario === 'school' ? 'Sekolah' : scenario === 'agency' ? 'Agensi' : 'Pejabat',
  ped_office_id: 'preview-office' });
const record = (category, index, extras = {}) => ({
  id: `${category}-${index}`, owner_id: userId, school_id: userId, office_id: 'preview-office', category,
  correspondence_date: '2026-11-03', created_at: `2026-11-03T00:${String(index).padStart(2, '0')}:00Z`,
  reference_number: `100-10/3/1 Pelantikan Petugas dan Penyelaras Program Sekolah (Jilid 1) · No. Surat ${index}`,
  correspondent: 'Sekolah Kebangsaan Bandar Limbang',
  subject: 'Pelaksanaan program pembangunan murid dan penyelarasan aktiviti sekolah bagi sesi persekolahan semasa.',
  status: 'Dihantar', ...extras
});
const records = () => scenario === 'school'
  ? [record('school_in', 1), record('school_received', 2, { status: 'Dalam proses' })]
  : [record('school_in', 1, { owner_id: 'another-school', school_id: 'another-school', office_id: userId }), ...Array.from({ length: scenario === 'paging' ? 12 : 2 }, (_, i) => record('outgoing', i + 1, { status: i ? 'Dihantar Semula' : 'Diterima' }))];
const allowed = new Set(['ped.html', 'assets/styles.css', 'assets/navigation.css', 'assets/ped.css', 'assets/supabase-app.js', 'file.png', 'Gemini_Generated_Image_vvxauovvxauovvxa.jpeg']);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = url.pathname.slice(1);
  if (file === 'assets/runtime-config.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(`globalThis.MYFAILPRO_CONFIG={url:'http://127.0.0.1:${server.address().port}',publishableKey:'preview-only'};`);
    return;
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/').pop();
    if (table === 'ped_correspondence' && req.method === 'PATCH') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        assert.deepEqual(payload, { status: 'Diterima' }, 'Receipt action may only update the status');
        const source = records().find(item => item.id === 'school_in-1');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify([{ ...source, ...payload }]));
      });
      return;
    }
    assert.equal(req.method, url.pathname.includes('/rpc/') ? 'POST' : 'GET', 'Unexpected preview request method');
    let result = [];
    if (table === 'can_access_ped') result = true;
    if (table === 'profiles') result = url.searchParams.has('ped_office_id')
      ? [{ id: 'another-school', name: 'SK Bandar Limbang' }]
      : url.searchParams.get('id') === 'eq.preview-office' ? [{ id: 'preview-office', name: 'PPD Limbang' }] : [profile()];
    if (table === 'agency_settings') result = [{ owner_id: userId, staff: [], functions: [], activities: [], sub_activities: [], transactions: [] }];
    if (table === 'ped_correspondence') result = records();
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
  }
  if (!allowed.has(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'image/png');
  res.end(fs.readFileSync(path.join(root, file)));
});

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map(); const exceptions = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (!message.id) return;
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id); clearTimeout(task.timeout);
    message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
  });
  return { ws, exceptions, send(method, params = {}) { return new Promise((resolve, reject) => {
    const callId = ++id;
    const timeout = setTimeout(() => { pending.delete(callId); reject(new Error(`Timeout: ${method}`)); }, 15000);
    pending.set(callId, { resolve, reject, timeout }); ws.send(JSON.stringify({ id: callId, method, params }));
  }); } };
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profileDir = path.join(output, 'browser');
  browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; !fs.existsSync(portFile) && i < 150; i++) await wait(100);
  assert(fs.existsSync(portFile), 'Browser debugging port unavailable');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const cdp = await connect(target.webSocketDebuggerUrl);
  const evaluate = async expression => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['https://*'] });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `sessionStorage.setItem('myfailpro_supabase_session',JSON.stringify({access_token:'preview',user:{id:'${userId}'}}));` });
  for (const role of ['office', 'agency', 'admin', 'school', 'paging']) {
    scenario = role;
    for (const width of role === 'paging' ? [1440] : [1440, 900, 390, 320]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `${base}/ped.html?preview=${role}-${width}` });
      let ready = false;
      for (let i = 0; !ready && i < 80; i++) { await wait(100); ready = await evaluate(`Boolean(document.querySelector('.ped-cell-reference'))`); }
      assert(ready, `${role} ${width}: page failed to render`);
      await wait(500);
      const metrics = await evaluate(`(() => {
        const panels=[...document.querySelectorAll('.ped-panel')].filter(p=>p.offsetParent&&p.querySelector('.table-wrap'));
        return {pageWidth:document.documentElement.scrollWidth, viewport:innerWidth,
          panels:panels.map(p=>{const w=p.querySelector('.table-wrap');return {verticalOverflow:w.scrollHeight-w.clientHeight};}),
          actionOverflow:[...document.querySelectorAll('.ped-row-actions')].some(a=>a.scrollWidth>a.clientWidth+1),
          actionDataNotCentered:innerWidth>640&&[...document.querySelectorAll('.ped-cell-actions')].some(cell=>{const buttons=[...cell.querySelectorAll('button')].map(button=>button.getBoundingClientRect());if(!buttons.length)return false;const bounds=cell.getBoundingClientRect(),groupCenter=(buttons[0].left+buttons[buttons.length-1].right)/2;return Math.abs(groupCenter-(bounds.left+bounds.right)/2)>1.5;}),
          actionColumnMismatch:innerWidth>640&&[...document.querySelectorAll('.ped-panel table')].filter(table=>table.querySelector('tbody tr:not(.ped-empty-row)')).some(table=>{const width=table.querySelector('th:last-child').getBoundingClientRect().width;return table.querySelector('.ped-receive-button')?Math.abs(width-280)>1.5:Math.abs(width-180)>1.5;}),
          headersNotCentered:innerWidth>640&&[...document.querySelectorAll('.ped-panel thead th:nth-child(5),.ped-panel thead th:nth-child(6)')].some(header=>getComputedStyle(header).textAlign!=='center'),
          statusNotCentered:innerWidth>640&&[...document.querySelectorAll('.ped-cell-status')].some(cell=>getComputedStyle(cell).textAlign!=='center'),
          statusOverflow:[...document.querySelectorAll('.ped-cell-status .ped-status')].some(b=>b.getBoundingClientRect().right>b.parentElement.getBoundingClientRect().right-parseFloat(getComputedStyle(b.parentElement).paddingRight)+1),
          animatedRows:document.querySelectorAll('.ped-panel tbody tr.reveal-item').length,
          formattedReferences:[...document.querySelectorAll('.ped-reference')].filter(reference=>reference.textContent.includes(' (1)')).length,
          receiveButtons:document.querySelectorAll('.ped-receive-button').length};
      })()`);
      assert(metrics.pageWidth <= width + 1, `${role} ${width}: page overflow ${JSON.stringify(metrics)}`);
      assert(metrics.panels.every(p => p.verticalOverflow <= 1), `${role} ${width}: vertical table scroll ${JSON.stringify(metrics)}`);
      assert(!metrics.actionOverflow, `${role} ${width}: action overflow`);
      assert(!metrics.actionDataNotCentered, `${role} ${width}: action data is not centered`);
      assert(!metrics.actionColumnMismatch, `${role} ${width}: action column width is incorrect`);
      assert(!metrics.headersNotCentered, `${role} ${width}: status or action header is not centered`);
      assert(!metrics.statusNotCentered, `${role} ${width}: status data is not centered`);
      assert(!metrics.statusOverflow, `${role} ${width}: status overflow`);
      assert.equal(metrics.animatedRows, 0);
      assert(metrics.formattedReferences > 0, `${role} ${width}: formatted letter number missing`);
      assert.equal(metrics.receiveButtons, ['office', 'paging'].includes(role) ? 1 : 0, `${role} ${width}: receipt action visibility`);
      if (role === 'paging') {
        await evaluate(`document.querySelector('[data-ped-page="outgoing"][data-direction="next"]').click()`);
        assert.equal(await evaluate(`document.querySelectorAll('[data-ped-rows="outgoing"] tr').length`), 2);
        await evaluate(`document.querySelector('[data-ped-sort="outgoing"]').click()`);
        assert.equal(await evaluate(`document.querySelector('[data-ped-sort="outgoing"]').closest('th').getAttribute('aria-sort')`), 'ascending');
      }
      if (width === 1440 || width === 390) {
        await evaluate(`document.querySelector('.ped-table-stack').scrollIntoView({behavior:'instant',block:'start'})`);
        await evaluate(`window.scrollBy({top:-document.querySelector('.topbar').getBoundingClientRect().height-16,behavior:'instant'})`);
        await wait(100);
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(output, `${role}-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      }
      if (['office', 'paging'].includes(role)) {
        await evaluate(`document.querySelector('.ped-receive-button').click()`);
        let received = false;
        for (let i = 0; !received && i < 40; i++) {
          await wait(100);
          received = await evaluate(`document.querySelector('[data-ped-rows="school_in"] .ped-cell-status')?.textContent.includes('Diterima')`);
        }
        assert(received, `${role} ${width}: receipt status was not updated`);
        assert.equal(await evaluate(`document.querySelectorAll('.ped-receive-button').length`), 0);
      }
      await evaluate(`document.querySelector('.ped-row-actions button').click()`);
      assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`), false);
      console.log(`${role} ${width}px: PASS`);
    }
  }
  assert.equal(cdp.exceptions.length, 0, cdp.exceptions.join('\n'));
  console.log(`Screenshots: ${output}`);
  await cdp.send('Browser.close').catch(() => {}); cdp.ws.close();
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (browser) browser.kill(); server.close(); });
