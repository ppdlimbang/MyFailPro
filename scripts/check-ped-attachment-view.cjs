// Runs through the local fixtures in check-ped-tables.cjs --attachment-view-only.
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({ assert, evaluate, cdp, base, record, userId, output, setup, denySigning, signedPaths }) => {
  const until = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('Timed out: ' + expression);
  };
  for (const role of ['office', 'admin', 'school']) {
    const category = role === 'school' ? 'school_in' : 'outgoing';
    const selector = `[data-ped-rows="${category}"] .ped-view-attachment`;
    const prefix = `[data-ped-rows="${category}"]`;
    for (const width of [1440, 900, 390, 320]) {
      const rows = [
        record(category, 1, { attachment_path: `${userId}/surat rasmi.pdf` }),
        record(category, 2, { attachment_path: `${userId}/gambar #1.png` }),
        record(category, 3, { attachment_path: null })
      ];
      setup(role, rows);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `${base}/ped.html?attachment-view=${role}-${width}` });
      await until(`document.querySelectorAll(${JSON.stringify(selector)}).length === 2`);
      const metrics = await evaluate(`(() => {
        const body = document.querySelector(${JSON.stringify(prefix)});
        const actions = [...body.querySelectorAll('.ped-row-actions')];
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          clipped: actions.some(a => a.scrollWidth > a.clientWidth + 1 || [...a.children].some(b => { const r=b.getBoundingClientRect(),p=a.getBoundingClientRect();return r.left<p.left-1||r.right>p.right+1; })),
          labels: [...body.querySelectorAll('.ped-view-attachment')].every(b => b.title==='Lihat lampiran' && b.getAttribute('aria-label').includes('tab baharu') && b.querySelector('[data-icon="eye"]')),
          emptyHasButton: [...body.querySelectorAll('tr')].find(r => r.querySelector('.ped-reference').textContent.endsWith('(3)'))?.querySelector('.ped-view-attachment') != null
        };
      })()`);
      assert.equal(metrics.overflow, false, `${role} ${width}: page overflow`);
      assert.equal(metrics.clipped, false, `${role} ${width}: clipped actions`);
      assert.equal(metrics.labels, true);
      assert.equal(metrics.emptyHasButton, false);
      await evaluate(`window.previewPopups=[];window.open=()=>{const p={opener:{},location:{},closed:false,close(){this.closed=true}};previewPopups.push(p);return p;};`);
      for (const [index, extension] of [[0, 'png'], [1, 'pdf']]) {
        const before = signedPaths.length;
        await evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].focus()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        try { await until(`Boolean(previewPopups[${index}]?.location.href)`); }
        catch (error) {
          console.error(await evaluate(`({focused:document.activeElement?.outerHTML,popups:previewPopups,toasts:document.querySelector('.toast-region')?.textContent})`));
          throw error;
        }
        assert.equal(signedPaths.length, before + 1);
        const popup = await evaluate(`({url:previewPopups[${index}].location.href,opener:previewPopups[${index}].opener})`);
        assert(popup.url.includes(extension === 'png' ? 'gambar%20%231.png' : 'surat%20rasmi.pdf'));
        assert.equal(popup.opener, null);
        assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`), true, 'Viewing must not open the edit form');
      }
      if (role === 'office' && [1440, 390].includes(width)) {
        await evaluate(`document.querySelector(${JSON.stringify(width === 390 ? selector : prefix)}).closest(${JSON.stringify(width === 390 ? 'tr' : '.ped-panel')}).scrollIntoView({block:'center',behavior:'instant'})`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(output, `attachment-view-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      console.log(`Attachment action ${role} ${width}px: PASS`);
    }
  }
  const selector = '[data-ped-rows="school_in"] .ped-view-attachment';
  denySigning(true);
  const before = signedPaths.length;
  await evaluate(`window.failedPopup={location:{},closed:false,close(){this.closed=true}};window.open=()=>failedPopup;const button=document.querySelector(${JSON.stringify(selector)});button.click();button.click();`);
  await until(`failedPopup.closed && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  assert.equal(signedPaths.length, before + 1, 'Repeated clicks must not start duplicate signing');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).hasAttribute('aria-busy')`), false);
  assert(await evaluate(`document.querySelector('.toast.error')?.textContent.includes('Lampiran tidak dapat dibuka')`));
  denySigning(false);
  await evaluate(`document.querySelector('#pedViewTabHistory').click()`);
  await until(`document.querySelectorAll('#pedHistoryRows .ped-view-attachment').length === 2`);
  console.log('PASS: PDF/image URLs, keyboard access, missing attachments, signed access failure, duplicate clicks and history actions.');
  console.log('Screenshots: ' + output);
};
