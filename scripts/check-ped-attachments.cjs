// Invoked by check-ped-tables.cjs against local HTTP fixtures, never live data.
module.exports = async ({ assert, evaluate, until, cdp, base, record, userId,
  setup, mode, denyUpload, records, uploads, deletedAttachments, formWrites }) => {
  const pdf = '%PDF-1.7\nTest attachment bytes\n%%EOF';
  const load = async (role, rows) => {
    setup(role, rows);
    await cdp.send('Page.navigate', { url: `${base}/ped.html?attachments=${role}` });
    await until("Boolean(document.querySelector('.ped-cell-reference'))", 'Attachment fixture failed to render');
  };
  const edit = async category => {
    await evaluate(`document.querySelector('[data-ped-rows="${category}"] .ped-row-actions button').click()`);
    assert.equal(await evaluate("document.querySelector('#pedModal').classList.contains('hidden')"), false);
  };
  const selectFile = async (name = 'surat.pdf', type = 'application/pdf', content = pdf, size = null) => {
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([${size === null ? JSON.stringify(content) : `new Uint8Array(${size})`}], ${JSON.stringify(name)}, {type:${JSON.stringify(type)}}));
      const input = document.querySelector('#pedAttachment'); input.files = transfer.files;
      input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  };
  const submit = async (success = true) => {
    const count = formWrites.length;
    assert.equal(await evaluate("document.querySelector('#pedForm').checkValidity()"), true, 'Form is invalid');
    await evaluate("document.querySelector('#pedForm').requestSubmit()");
    await until("!document.querySelector('#pedForm button[type=submit]').disabled", 'Form did not finish saving');
    assert.equal(formWrites.length, count + 1, 'Form did not reach record write');
    assert.equal(await evaluate("document.querySelector('#pedModal').classList.contains('hidden')"), success);
  };
  const outgoing = () => record('outgoing', 1, { reference_number: null, attachment_path: null });
  await load('office', [outgoing()]);
  await evaluate("document.querySelector('[data-add-ped=outgoing]').click();document.querySelector('#pedCorrespondent').value='Penerima';document.querySelector('#pedSubject').value='Surat tanpa lampiran'");
  assert.equal(await evaluate("document.querySelector('#pedAttachment').required"), false);
  assert.equal(await evaluate("document.querySelector('#pedAttachmentField').classList.contains('hidden')"), false);
  await submit();
  assert.equal(formWrites.at(-1).attachment_path, null);
  assert.equal(uploads.length, 0, 'Optional empty attachment must not upload');

  await load('office', [outgoing()]);
  await edit('outgoing'); await selectFile(); await submit();
  assert.equal(uploads.at(-1).type, 'application/pdf');
  assert.equal(uploads.at(-1).body.toString(), pdf, 'PDF bytes must remain unchanged');
  assert.match(records()[0].attachment_path, /^preview-user\/.+\.pdf$/);
  const firstPath = records()[0].attachment_path;
  await edit('outgoing');
  await evaluate("window.testPopup={location:{},close(){}};window.open=()=>window.testPopup;document.querySelector('#pedViewAttachment').click()");
  await until("Boolean(window.testPopup.location.href)", 'Signed attachment did not open');
  assert.match(await evaluate('window.testPopup.location.href'), /\/storage\/v1\/object\/sign\//);

  for (const failure of ['denied', 'empty']) {
    mode(failure); await selectFile('replacement.pdf'); await submit(false);
    assert.equal(records()[0].attachment_path, firstPath);
    assert(deletedAttachments.includes(uploads.at(-1).path), 'Failed write must clean new upload');
    assert(!deletedAttachments.includes(firstPath), 'Failed write must preserve old file');
  }
  mode('success');
  await selectFile('replacement.PDF', ''); await submit();
  assert.equal(uploads.at(-1).type, 'application/pdf', 'Missing MIME should use safe PDF extension');
  assert(deletedAttachments.includes(firstPath), 'Successful replacement must clean old file');
  const replacement = records()[0].attachment_path;
  await edit('outgoing');
  await evaluate("document.querySelector('#pedClearAttachment').click()");
  assert(!deletedAttachments.includes(replacement), 'Removal must wait for save');
  mode('denied'); await submit(false);
  assert(!deletedAttachments.includes(replacement));
  mode('success'); await submit();
  assert.equal(records()[0].attachment_path, null);
  assert(deletedAttachments.includes(replacement));

  // Invalid subsequent selections must not leave a previous valid file queued.
  for (const [name, type, content, size] of [
    ['unsafe.exe', 'application/x-msdownload', 'bad', null],
    ['unsafe.svg', 'image/svg+xml', '<svg/>', null],
    ['empty.pdf', 'application/pdf', '', null],
    ['large.pdf', 'application/pdf', '', 20 * 1024 * 1024 + 1]
  ]) {
    await edit('outgoing'); await selectFile(); await selectFile(name, type, content, size);
    const count = uploads.length;
    assert.equal(await evaluate("document.querySelector('#pedAttachment').files.length"), 0);
    await submit();
    assert.equal(uploads.length, count, 'Invalid selection left stale upload queued');
  }
  await edit('outgoing'); await selectFile(); denyUpload(true);
  const writesBefore = formWrites.length;
  await evaluate("document.querySelector('#pedForm').requestSubmit()");
  await until("!document.querySelector('#pedForm button[type=submit]').disabled", 'Upload failure did not recover');
  assert.equal(formWrites.length, writesBefore, 'Upload failure must prevent record write');
  assert.equal(records()[0].attachment_path, null);
  denyUpload(false);

  const schoolRecord = status => record('school_in', 1, {
    reference_number: '100-1 (Jilid 1) · No. Surat 1', status,
    attachment_path: `${userId}/school.pdf`
  });
  await load('school', [schoolRecord('Dihantar')]); await edit('school_in');
  assert.equal(await evaluate("document.querySelector('#pedAttachment').disabled"), false);
  await selectFile(); await submit();
  assert.equal(formWrites.at(-1).attachment_path, uploads.at(-1).path, 'School update must persist uploaded path');
  for (const [role, row] of [
    ['school', schoolRecord('Diterima')],
    ['office', { ...schoolRecord('Diterima'), owner_id:'another-school', school_id:'another-school', office_id:userId, attachment_path:'another-school/surat.pdf' }]
  ]) {
    await load(role, [row]); await edit('school_in');
    assert.equal(await evaluate("document.querySelector('#pedAttachment').disabled"), true);
    assert.equal(await evaluate("document.querySelector('#pedViewAttachment').classList.contains('hidden')"), false);
    assert.equal(await evaluate("document.querySelector('#pedClearAttachment').classList.contains('hidden')"), true);
  }
  console.log('Attachments: optional create, PDF bytes, signed view, replace/remove, failed writes/uploads, invalid files and school access PASS');
};
