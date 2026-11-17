// Exercise the actual Edge Function handler with isolated Auth/REST fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = stripTypeScriptTypes(fs.readFileSync('supabase/functions/office-update-school-account/index.ts', 'utf8')
  .replace(/^import .*;\r?\n/gm, ''));
const schoolId = '11111111-1111-4111-8111-111111111111';

async function run(role, agencyType, assigned = true) {
  let handler;
  const calls = [];
  const reply = data => new Response(JSON.stringify(data), { status: 200 });
  vm.runInNewContext(source, {
    Deno: { serve: fn => { handler = fn; } },
    preflight: () => null, isOriginAllowed: () => true,
    serviceConfig: () => ({ url: 'https://fixture.test', publicKey: 'public-fixture', secretKey: 'secret-fixture' }),
    json: (_request, data, status) => new Response(JSON.stringify(data), { status }),
    fetch: async (url, options = {}) => {
      const parsed = new URL(url);
      calls.push({ url: parsed, options });
      if (parsed.pathname === '/auth/v1/user') return reply({ id: 'actor-id' });
      if (parsed.searchParams.get('id') === 'eq.actor-id') return reply([{ id: 'actor-id', role, agency_type: agencyType, agency_id: 'office-id' }]);
      if (parsed.pathname === '/rest/v1/profiles') {
        assert.equal(parsed.searchParams.get('role'), 'eq.agency');
        assert.equal(parsed.searchParams.get('agency_type'), 'ilike.sekolah');
        assert.equal(parsed.searchParams.get('ped_office_id'), role === 'admin' ? null : 'eq.actor-id');
        if (options.method === 'PATCH') return reply({});
        return reply(assigned || role === 'admin' ? [{ id: schoolId, name: 'Old', email: 'old@example.test' }] : []);
      }
      if (parsed.pathname === '/auth/v1/admin/users/' + schoolId) return reply({ email: 'old@example.test' });
      throw new Error('Unexpected request: ' + url);
    }
  });
  const response = await handler(new Request('https://fixture.test/function', {
    method: 'POST', headers: { authorization: 'Bearer fixture' },
    body: JSON.stringify({ id: schoolId, name: 'SK Ujian', email: 'new@example.test', password: '' })
  }));
  return { response, calls };
}

(async () => {
  for (const [role, type] of [['staff', 'Pejabat'], ['staff', 'Sekolah'], ['agency', 'Sekolah'], ['agency', 'Agensi']]) {
    const { response, calls } = await run(role, type);
    assert.equal(response.status, 403, role + ' ' + type);
    assert.equal(calls.length, 2, 'Reject before service-role access to school accounts');
  }
  for (const role of ['admin', 'agency']) {
    const { response, calls } = await run(role, 'Pejabat');
    assert.equal(response.status, 200);
    assert(calls.some(call => call.options.method === 'PATCH'));
  }
  const denied = await run('agency', 'Pejabat', false);
  assert.equal(denied.response.status, 404);
  assert(!denied.calls.some(call => ['PATCH', 'PUT'].includes(call.options.method)));
  assert.equal((await run('admin', 'Pejabat', false)).response.status, 200);
  console.log('PASS: staff denied before privileged requests; admins allowed; agency limited to assigned schools.');
})().catch(error => { console.error(error); process.exitCode = 1; });
