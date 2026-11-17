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
let storedRecords = null;
let patchMode = 'success';
const patches = [];
let attachmentChecks = false;
let uploadDenied = false;
let signingDenied = false;
const signedPaths = [];
const pdfParts = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
const pdfContent = 'BT /F1 24 Tf 60 760 Td (Surat Ujian MyFailPro) Tj 0 -40 Td /F1 14 Tf (Pratonton dokumen pada halaman yang sama.) Tj ET';
pdfParts.push(`<< /Length ${Buffer.byteLength(pdfContent)} >>\nstream\n${pdfContent}\nendstream`);
let previewPdf = '%PDF-1.4\n';
const pdfOffsets = [0];
pdfParts.forEach((part, i) => { pdfOffsets.push(Buffer.byteLength(previewPdf)); previewPdf += `${i + 1} 0 obj\n${part}\nendobj\n`; });
const pdfXref = Buffer.byteLength(previewPdf);
previewPdf += `xref\n0 6\n0000000000 65535 f \n${pdfOffsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pdfXref}\n%%EOF`;
const uploads = [], deletedAttachments = [], formWrites = [];
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
const records = () => storedRecords || (scenario === 'school'
  ? [record('school_in', 1), record('school_received', 2, { status: 'Dalam proses' })]
  : [record('school_in', 1, { owner_id: 'another-school', school_id: 'another-school', office_id: userId }), ...Array.from({ length: scenario === 'paging' ? 12 : 2 }, (_, i) => record('outgoing', i + 1, { status: i ? 'Dihantar Semula' : 'Diterima' }))]);
const allowed = new Set(['ped.html', 'assets/styles.css', 'assets/navigation.css', 'assets/ped.css', 'assets/icons.css', 'assets/supabase-app.js', 'file.png', 'Gemini_Generated_Image_vvxauovvxauovvxa.jpeg', ...fs.readdirSync(path.join(root, 'assets/icons')).map(name => `assets/icons/${name}`)]);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = url.pathname.slice(1);
  if (attachmentChecks && url.pathname.startsWith('/storage/v1/')) {
    if (req.method === 'GET' && url.searchParams.get('token') === 'fixture') {
      const pdf = url.pathname.endsWith('.pdf');
      res.setHeader('Content-Type', pdf ? 'application/pdf' : 'image/png');
      res.setHeader('Content-Disposition', 'inline');
      res.end(pdf ? previewPdf : fs.readFileSync(path.join(root, 'file.png')));
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'DELETE') {
        deletedAttachments.push(...JSON.parse(body).prefixes);
        res.end('[]');
      } else if (url.pathname.includes('/object/sign/')) {
        assert.deepEqual(JSON.parse(body), { expiresIn: 300 });
        signedPaths.push(url.pathname);
        if (signingDenied) res.writeHead(403).end(JSON.stringify({ message: 'Akses lampiran ditolak untuk ujian.' }));
        else setTimeout(() => res.end(JSON.stringify({ signedURL: url.pathname.slice('/storage/v1'.length) + '?token=fixture' })), 100);
      } else {
        uploads.push({ path: url.pathname.split('/ped-correspondence/')[1], type: req.headers['content-type'], body });
        if (uploadDenied) res.writeHead(400).end(JSON.stringify({ message: 'PDF MIME type not allowed (test).' }));
        else res.end('{}');
      }
    });
    return;
  }
  if (file === 'assets/runtime-config.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(`globalThis.MYFAILPRO_CONFIG={url:'http://127.0.0.1:${server.address().port}',publishableKey:'preview-only'};`);
    return;
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const table = url.pathname.split('/').pop();
    if (attachmentChecks && table === 'ped_correspondence' && ['POST', 'PATCH'].includes(req.method)) {
      let body = '';
      req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body);
        formWrites.push(payload);
        res.setHeader('Content-Type', 'application/json');
        if (patchMode === 'denied') { res.writeHead(403).end(JSON.stringify({ message: 'Akses ditolak untuk ujian.' })); return; }
        if (patchMode === 'empty') { res.end('[]'); return; }
        const source = records().find(item => `eq.${item.id}` === url.searchParams.get('id'));
        const saved = { ...(source || record(payload.category, 9)), ...payload };
        storedRecords = source ? records().map(item => item.id === source.id ? saved : item) : [...records(), saved];
        res.end(JSON.stringify([saved]));
      });
      return;
    }
    if (table === 'ped_correspondence' && req.method === 'PATCH') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const payload = JSON.parse(body || '{}');
        assert.deepEqual(Object.keys(payload), ['status'], 'Inline updates may only change status');
        const source = records().find(item => `eq.${item.id}` === url.searchParams.get('id'));
        assert(source, 'Update must target a known record');
        assert.equal(url.searchParams.get('status'), `eq.${source.status}`, 'Update must guard against concurrent status changes');
        patches.push({ id: source.id, status: payload.status });
        res.setHeader('Content-Type', 'application/json');
        if (patchMode === 'denied') { res.writeHead(403).end(JSON.stringify({ message: 'Akses ditolak untuk ujian.' })); return; }
        if (patchMode === 'empty') { res.end('[]'); return; }
        setTimeout(() => {
          const saved = { ...source, ...payload };
          storedRecords = records().map(item => item.id === source.id ? saved : item);
          res.end(JSON.stringify([saved]));
        }, patchMode === 'slow' ? 350 : 0);
      });
      return;
    }
    assert.equal(req.method, url.pathname.includes('/rpc/') ? 'POST' : 'GET', 'Unexpected preview request method');
    let result = [];
    if (table === 'can_access_ped') result = true;
    if (table === 'ped_assigned_schools') result = [{ id: 'another-school', name: 'SK Bandar Limbang' }];
    if (table === 'profiles') result = url.searchParams.has('ped_office_id')
      ? [{ id: 'another-school', name: 'SK Bandar Limbang' }]
      : url.searchParams.get('id') === 'eq.preview-office' ? [{ id: 'preview-office', name: 'PPD Limbang' }] : [profile()];
    if (table === 'agency_settings') result = [{ owner_id: userId, staff: [], functions: [], activities: [], sub_activities: [], transactions: [] }];
    if (table === 'ped_correspondence') result = records();
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
  }
  if (!allowed.has(file)) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
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
  if (process.argv.includes('--attachment-view-only')) {
    attachmentChecks = true;
    await require('./check-ped-attachment-view.cjs')({ assert, evaluate, cdp, base, record, userId, output,
      setup(role, rows) { scenario = role; storedRecords = rows; },
      denySigning(value) { signingDenied = value; }, signedPaths });
    assert.equal(cdp.exceptions.length, 0, cdp.exceptions.join('\n'));
    await cdp.send('Browser.close').catch(() => {}); cdp.ws.close();
    return;
  }
  for (const role of process.env.PED_INLINE_ONLY ? [] : ['office', 'agency', 'admin', 'school', 'paging']) {
    scenario = role;
    for (const width of role === 'paging' ? [1440] : [1440, 900, 390, 320]) {
      storedRecords = null;
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
          received = await evaluate(`document.querySelector('[data-ped-rows="school_in"] .ped-inline-status-select')?.value === 'Diterima'`);
        }
        assert(received, `${role} ${width}: receipt status was not updated`);
        assert.equal(await evaluate(`document.querySelectorAll('.ped-receive-button').length`), 0);
      }
      await evaluate(`document.querySelector('.ped-row-actions button').click()`);
      assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`), false);
      console.log(`${role} ${width}px: PASS`);
    }
  }
  const until = async (expression, message) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await wait(50); }
    assert.fail(message);
  };
  const inlineSelector = (id, scope = '#pedListView') => `${scope} select[data-ped-status-record="${id}"]`;
  const choose = async (id, value, scope) => {
    const selector = inlineSelector(id, scope);
    await evaluate(`(() => { const select=document.querySelector(${JSON.stringify(selector)}); select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  };
  const expectStatus = async (id, status, scope) => {
    await until(`document.querySelector(${JSON.stringify(inlineSelector(id, scope))})?.value === ${JSON.stringify(status)} && !document.querySelector(${JSON.stringify(inlineSelector(id, scope))})?.disabled`, `Status ${id} did not settle at ${status}`);
    assert.equal(storedRecords.find(item => item.id === id).status, status);
  };
  // All three table views share the same persisted status control.
  scenario = 'office';
  storedRecords = [record('agency_in',1,{status:'Belum diminit'}),record('outgoing',1),record('school_in',1,{owner_id:'another-school',school_id:'another-school',office_id:userId})];
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:base+'/ped.html?inline'});
  await until(`Boolean(document.querySelector(${JSON.stringify(inlineSelector('agency_in-1'))}))`,'Inline status control missing');
  assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`),true);
  await choose('agency_in-1','Dalam proses');
  await expectStatus('agency_in-1','Dalam proses');
  await choose('outgoing-1','Diterima');
  await expectStatus('outgoing-1','Diterima');
  assert.equal(await evaluate(`Array.from(document.querySelector(${JSON.stringify(inlineSelector('school_in-1'))}).options).some(o=>o.value==='Dihantar Semula')`),false);
  await choose('school_in-1','Diterima');
  await expectStatus('school_in-1','Diterima');
  await evaluate(`document.querySelector('[data-ped-view="history"]').click()`);
  await choose('outgoing-1','Selesai','#pedHistoryView');
  await expectStatus('outgoing-1','Selesai','#pedHistoryView');
  await expectStatus('outgoing-1','Selesai');
  await evaluate(`document.querySelector('[data-ped-view="schools"]').click();document.querySelector('.ped-school-card').click()`);
  await choose('school_in-1','Dalam proses','#pedSchoolsView');
  await expectStatus('school_in-1','Dalam proses','#pedSchoolsView');
  await expectStatus('school_in-1','Dalam proses');
  await evaluate(`document.querySelector('[data-ped-view="list"]').click()`);
  // Failed and empty writes must keep the last confirmed value and allow retry.
  for (const mode of ['denied','empty']) {
    patchMode=mode;
    const count=patches.length;
    await choose('agency_in-1','Selesai');
    await until(`!document.querySelector(${JSON.stringify(inlineSelector('agency_in-1'))}).disabled && document.querySelector(${JSON.stringify(inlineSelector('agency_in-1'))}).value==='Dalam proses'`,'Failed write did not restore status');
    assert.equal(patches.length,count+1);
    assert.equal(storedRecords.find(r=>r.id==='agency_in-1').status,'Dalam proses');
  }
  patchMode='slow';
  const before=patches.length;
  await choose('agency_in-1','Selesai');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inlineSelector('agency_in-1'))}).disabled`),true);
  await choose('agency_in-1','Sudah diminit');
  await expectStatus('agency_in-1','Selesai');
  assert.equal(patches.length,before+1,'Duplicate writes were not prevented');
  patchMode='success';
  // Saving refreshes the active filter rather than leaving a stale row behind.
  await evaluate(`const statusFilter=document.querySelector('#pedStatusFilter');statusFilter.value='Selesai';statusFilter.dispatchEvent(new Event('change',{bubbles:true}));`);
  await choose('agency_in-1','Dalam proses');
  await until(`!document.querySelector(${JSON.stringify(inlineSelector('agency_in-1'))})`,'Updated row did not leave the active status filter');
  assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`),true);
  console.log('Inline status: all categories/views, persistence, failures, concurrency and filters PASS');
  // School processing locks and resend permissions remain enforced in the UI.
  scenario='school';
  storedRecords=[record('school_in',1,{status:'Diterima'}),record('school_in',2,{status:'Dikembalikan'}),record('school_in',3),record('school_received',1,{status:'Belum diminit'})];
  await cdp.send('Page.navigate',{url:base+'/ped.html?school-inline'});
  await until(`Boolean(document.querySelector(${JSON.stringify(inlineSelector('school_received-1'))}))`,'School incoming control missing');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inlineSelector('school_in-1'))})`),null);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(inlineSelector('school_in-3'))})`),null);
  assert.deepEqual(await evaluate(`Array.from(document.querySelector(${JSON.stringify(inlineSelector('school_in-2'))}).options).map(o=>o.value)`),['Dikembalikan','Dihantar Semula']);
  await choose('school_received-1','Selesai');
  await expectStatus('school_received-1','Selesai');
  await choose('school_in-2','Dihantar Semula');
  await until(`!document.querySelector(${JSON.stringify(inlineSelector('school_in-2'))})`,'Resent school letter should have no further status choices');
  assert.equal(storedRecords.find(r=>r.id==='school_in-2').status,'Dihantar Semula');
  console.log('Inline status: school incoming, locked letters and permitted resend PASS');
  attachmentChecks = true;
  await require('./check-ped-attachments.cjs')({ assert, evaluate, until, cdp, base, record, userId,
    setup(role, rows) { scenario = role; storedRecords = rows; patchMode = 'success'; uploadDenied = false; },
    mode(value) { patchMode = value; }, denyUpload(value) { uploadDenied = value; },
    records: () => storedRecords, uploads, deletedAttachments, formWrites });
  assert.equal(cdp.exceptions.length, 0, cdp.exceptions.join('\n'));
  console.log(`Screenshots: ${output}`);
  await cdp.send('Browser.close').catch(() => {}); cdp.ws.close();
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (browser) browser.kill(); server.close(); });
