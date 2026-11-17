// Runs through local fixtures: node scripts/check-ped-tables.cjs --attachment-view-only.
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
  const close = async () => {
    await evaluate(`document.querySelector('#pedAttachmentPreview [data-close-preview]').click()`);
    await until(`!document.querySelector('#pedAttachmentPreview').open && !document.querySelector('.ped-attachment-preview-content').children.length`);
  };
  for (const role of ['office', 'admin', 'school']) {
    const category = role === 'school' ? 'school_in' : 'outgoing';
    const selector = `[data-ped-rows="${category}"] .ped-view-attachment`;
    const prefix = `[data-ped-rows="${category}"]`;
    for (const width of [1440, 900, 390, 320]) {
      setup(role, [
        record(category, 1, { attachment_path: `${userId}/surat rasmi.pdf` }),
        record(category, 2, { attachment_path: `${userId}/gambar #1.png` }),
        record(category, 3, { attachment_path: null })
      ]);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
      const pageUrl = `${base}/ped.html?attachment-view=${role}-${width}`;
      await cdp.send('Page.navigate', { url: pageUrl });
      await until(`document.querySelectorAll(${JSON.stringify(selector)}).length === 2`);
      const metrics = await evaluate(`(() => {
        const body = document.querySelector(${JSON.stringify(prefix)});
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          clipped: [...body.querySelectorAll('.ped-row-actions')].some(a => a.scrollWidth > a.clientWidth + 1),
          labels: [...body.querySelectorAll('.ped-view-attachment')].every(b => b.getAttribute('aria-haspopup')==='dialog' && !b.getAttribute('aria-label').includes('tab baharu')),
          emptyHasButton: [...body.querySelectorAll('tr')].find(r => r.querySelector('.ped-reference').textContent.endsWith('(3)'))?.querySelector('.ped-view-attachment') != null
        };
      })()`);
      assert.deepEqual(metrics, { overflow: false, clipped: false, labels: true, emptyHasButton: false });
      await evaluate(`window.previewPopups=0;window.open=()=>{previewPopups++;return null;};`);
      for (const [index, extension] of [[0, 'png'], [1, 'pdf']]) {
        const before = signedPaths.length;
        await evaluate(`document.querySelectorAll(${JSON.stringify(selector)})[${index}].focus()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        const tag = extension === 'png' ? 'img' : 'iframe';
        await until(`document.querySelector('#pedAttachmentPreview').open && Boolean(document.querySelector('#pedAttachmentPreview ${tag}'))`);
        if (tag === 'img') await until(`document.querySelector('#pedAttachmentPreview img').naturalWidth > 0`);
        await until(`document.querySelector('.ped-attachment-preview-status').classList.contains('hidden')`);
        assert.equal(signedPaths.length, before + 1);
        const src = await evaluate(`document.querySelector('#pedAttachmentPreview ${tag}').src`);
        assert(src.includes(extension === 'png' ? 'gambar%20%231.png' : 'surat%20rasmi.pdf'));
        assert.equal(await evaluate(`location.href`), pageUrl);
        assert.equal(await evaluate(`previewPopups`), 0);
        assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`), true);
        assert(await evaluate(`(() => { const d=document.querySelector('#pedAttachmentPreview'),r=d.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1&&d.scrollWidth<=d.clientWidth+1; })()`), 'Preview must fit viewport');
        if (role === 'office' && [1440, 390].includes(width)) {
          const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(output, `attachment-modal-${extension}-${width}.png`), Buffer.from(shot.data, 'base64'));
        }
        // Escape works from the preview toolbar; closing removes the embedded URL.
        await evaluate(`document.querySelector('#pedAttachmentPreview [data-close-preview]').focus()`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await until(`!document.querySelector('#pedAttachmentPreview').open && !document.querySelector('.ped-attachment-preview-content').children.length`);
        assert.equal(await evaluate(`document.activeElement === document.querySelectorAll(${JSON.stringify(selector)})[${index}]`), true);
        assert.equal(await evaluate(`document.body.style.overflow`), '');
      }
      console.log(`Attachment modal ${role} ${width}px: PASS`);
    }
  }
  const selector = '[data-ped-rows="school_in"] .ped-view-attachment';
  denySigning(true);
  const before = signedPaths.length;
  await evaluate(`const button=document.querySelector(${JSON.stringify(selector)});button.click();button.click();`);
  await until(`document.querySelector('.ped-attachment-preview-status').classList.contains('error') && !document.querySelector(${JSON.stringify(selector)}).disabled`);
  assert.equal(signedPaths.length, before + 1);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).hasAttribute('aria-busy')`), false);
  assert(await evaluate(`document.querySelector('.ped-attachment-preview-status').textContent.includes('Lampiran tidak dapat dibuka')`));
  await close();
  denySigning(false);
  // Closing while signing must not bring back the preview or insert late content.
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click();document.querySelector('#pedAttachmentPreview [data-close-preview]').click()`);
  await until(`!document.querySelector(${JSON.stringify(selector)}).disabled`);
  assert(await evaluate(`!document.querySelector('#pedAttachmentPreview').open && !document.querySelector('.ped-attachment-preview-content').children.length`));
  // Opening from the editor must preserve unsaved text and the editor's scroll lock.
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('tr').querySelector('button').click();document.querySelector('#pedSubject').value='Perubahan belum disimpan';document.querySelector('#pedViewAttachment').click()`);
  await until(`Boolean(document.querySelector('#pedAttachmentPreview img'))`);
  await close();
  assert.equal(await evaluate(`document.querySelector('#pedModal').classList.contains('hidden')`), false);
  assert.equal(await evaluate(`document.querySelector('#pedSubject').value`), 'Perubahan belum disimpan');
  assert.equal(await evaluate(`document.body.style.overflow`), 'hidden');
  await evaluate(`document.querySelector('#pedModal [data-close]').click();document.querySelector('#pedViewTabHistory').click()`);
  await until(`document.querySelectorAll('#pedHistoryRows .ped-view-attachment').length === 2`);
  assert.equal(await evaluate('previewPopups'), 0);
  console.log('PASS: image/PDF embedded previews, no navigation/popups, keyboard dismissal, viewport fit, focus restoration, failed signing, duplicate clicks, pending close and unsaved editor state.');
  console.log('Screenshots: ' + output);
};
