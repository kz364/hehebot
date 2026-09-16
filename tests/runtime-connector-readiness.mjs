import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../config/connector-catalog.json' with { type: 'json' };
import { classifyConnectorReadiness, describeWhatsAppReadiness } from '../runtime/connector-readiness.mjs';
import { readWappMcp } from '../runtime/wappmcp-reads.mjs';

const evidence = () => ({ advertised: true, installed: false, artifact: 'verified', protocol: 'synthetic-verified', authorization: 'not-checked' });
const authority = 'Fresh Worker authorization for the exact task, attempt, tool and chat, with current lease/revocation and deadline checks, is required for every call.';

test('disposable artifact and synthetic success do not imply installation or callability', () => {
  const input = Object.freeze(evidence());
  const result = classifyConnectorReadiness(input);
  assert.deepEqual(result, {
    evidence: evidence(),
    missing: ['Installation is not established.', 'Only synthetic protocol evidence exists; live callability is unverified.', authority],
    authority: 'not-granted', notificationsAvailable: false, mutationsAvailable: false, importedRoutinesSend: false, coverage: 'unknown',
  });
  result.evidence.installed = true;
  result.missing.length = 0;
  assert.equal(input.installed, false);
  assert.equal(classifyConnectorReadiness(input).missing.length, 3);
});

test('asymmetric observations preserve each independent failure, including denied authority', () => {
  const cases = [
    [{ advertised: false, installed: true, artifact: 'mismatch', protocol: 'live-verified', authorization: 'denied' },
      ['Operation is not advertised.', 'Pinned artifact verification failed.', 'The observed individual authorization was denied.', authority]],
    [{ advertised: true, installed: true, artifact: 'unknown', protocol: 'incompatible', authorization: 'observed-allowed' },
      ['Pinned artifact verification is missing.', 'Protocol result is incompatible; a reviewed fix and compatibility rerun are required.', authority]],
    [{ advertised: false, installed: false, artifact: 'verified', protocol: 'unknown', authorization: 'observed-allowed' },
      ['Operation is not advertised.', 'Installation is not established.', 'Protocol callability is unverified.', authority]],
    [{ advertised: true, installed: true, artifact: 'verified', protocol: 'live-verified', authorization: 'observed-allowed' }, [authority]],
  ];
  for (const [input, missing] of cases) {
    const result = classifyConnectorReadiness(input);
    assert.deepEqual(result.evidence, input);
    assert.deepEqual(result.missing, missing);
  }
});

test('all 144 evidence combinations retain no-send, unknown coverage and per-call authorization', () => {
  let count = 0;
  for (const advertised of [false, true]) for (const installed of [false, true])
    for (const artifact of ['unknown', 'verified', 'mismatch'])
      for (const protocol of ['unknown', 'incompatible', 'synthetic-verified', 'live-verified'])
        for (const authorization of ['not-checked', 'denied', 'observed-allowed']) {
          const result = classifyConnectorReadiness({ advertised, installed, artifact, protocol, authorization });
          assert.equal(result.authority, 'not-granted');
          assert.equal(result.notificationsAvailable, false);
          assert.equal(result.mutationsAvailable, false);
          assert.equal(result.importedRoutinesSend, false);
          assert.equal(result.coverage, 'unknown');
          assert.equal(result.missing.at(-1), authority);
          assert.equal(Object.hasOwn(result, 'allowed'), false);
          assert.equal(Object.hasOwn(result, 'chatIds'), false);
          count++;
        }
  assert.equal(count, 144);
});

test('malformed and unknown evidence is rejected without executing accessors or exposing content', () => {
  let accessed = false;
  const accessor = Object.defineProperty(evidence(), 'protocol', { get() { accessed = true; return 'live-verified'; } });
  const inputs = [undefined, null, [], true, 'PRIVATE', 1, new Date(), {}, accessor,
    Object.assign(Object.create({ inherited: true }), evidence()),
    { ...evidence(), [Symbol('PRIVATE')]: true }, { ...evidence(), connected: true },
    { ...evidence(), notificationAllowlist: ['PRIVATE'] }];
  for (const field of Object.keys(evidence())) {
    const missing = evidence(); delete missing[field]; inputs.push(missing);
    for (const bad of [undefined, null, {}, [], 0, 'PRIVATE', 'true']) inputs.push({ ...evidence(), [field]: bad });
  }
  for (const input of inputs) assert.throws(() => classifyConnectorReadiness(input), {
    code: 'INVALID_CONNECTOR_EVIDENCE', message: 'INVALID_CONNECTOR_EVIDENCE',
  });
  assert.equal(accessed, false);
  assert.deepEqual(classifyConnectorReadiness(Object.assign(Object.create(null), evidence())).evidence, evidence());
});

test('pinned baseline names missing prerequisites and recent blocker even when describing scoped search', () => {
  for (const tool of ['whatsapp_get_chat_messages', 'whatsapp_search_messages']) {
    const result = describeWhatsAppReadiness(tool);
    assert.equal(result.tool, tool);
    assert.deepEqual(result.evidence, { advertised: true, installed: false, artifact: 'verified',
      protocol: tool === 'whatsapp_get_chat_messages' ? 'incompatible' : 'synthetic-verified', authorization: 'not-checked' });
    const claim = result.missing.join('\n');
    for (const required of [/Installation is not established/, /Node 24\+.*Chrome/, /private persistent LocalAuth/,
      /single-installation process\/descendant/, /Separately authorized QR pairing/, /Separate live selected-chat/,
      /structuredContent is an array; SDK 1\.30\.0 requires an object/, /Scoped search is not recent-history coverage/,
      /account\/platform terms/, /cost evidence/, /license.*review/, /Fresh Worker authorization/]) assert.match(claim, required);
    assert.match(result.evidenceScope, /no installed, paired or callable runtime/);
    result.missing.length = 0;
    result.evidence.protocol = 'live-verified';
    assert.notEqual(describeWhatsAppReadiness(tool).evidence.protocol, 'live-verified');
  }
  for (const tool of [undefined, null, {}, 'unknown', 'whatsapp_send_message', 'notifications', '__proto__']) {
    assert.throws(() => describeWhatsAppReadiness(tool), { code: 'INVALID_CONNECTOR_EVIDENCE' });
  }
});

test('catalog pins the selected artifacts and only the exact approved patch', () => {
  const entry = catalog.whatsapp;
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(entry.package, 'wappmcp');
  assert.equal(entry.version, '0.4.0');
  assert.equal(entry.revision, '9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8');
  assert.equal(entry.artifactSha256, 'f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8');
  assert.deepEqual(entry.dependency, { package: 'whatsapp-web.js', version: '1.34.7', license: 'Apache-2.0',
    artifactSha256: '714e51cc23d1855ac200b99ad063fe8025208d4feca86dad4c27ffdaff096c0c' });
  assert.deepEqual(entry.approvedPatch, { path: 'patches/whatsapp-web.js+1.34.7.patch',
    sha256: 'b2b582a7650545d6e7534e7a66731a8b546b309efd6bce9e0e9a4722e0a616cf', additionalPatchesApproved: false });
  assert.equal(entry.protocol.sdkVersion, '1.30.0');
  assert.equal(entry.notificationsAvailable, false);
  assert.equal(entry.mutationsAvailable, false);
  assert.equal(entry.importedRoutinesSend, false);
  assert.equal(entry.coverage, 'unknown');
});

test('advertised/installed/live-callable facts cannot serve as a grant or override host task denial', async () => {
  let calls = 0;
  const call = async () => { calls++; throw new Error('must not dispatch'); };
  const result = classifyConnectorReadiness({ advertised: true, installed: true, artifact: 'verified',
    protocol: 'live-verified', authorization: 'observed-allowed' });
  const tool = 'whatsapp_search_messages';
  const args = { chatId: 'family@g.us', query: 'meeting' };
  await assert.rejects(readWappMcp(result, tool, args, call), { code: 'WHATSAPP_READ_DENIED' });
  const grant = { chatIds: ['family@g.us'], tools: [tool] };
  // Exact host task denial wins over even a previously observed allowed result.
  await assert.rejects(readWappMcp(grant, tool, args, call, { authorize: async () => false }), { code: 'WHATSAPP_READ_DENIED' });
  // Neither a foreign chat nor a mutation inherits the granted read scope.
  await assert.rejects(readWappMcp(grant, tool, { ...args, chatId: 'other@g.us' }, call), { code: 'WHATSAPP_READ_DENIED' });
  await assert.rejects(readWappMcp(grant, 'whatsapp_send_message', args, call), { code: 'WHATSAPP_READ_DENIED' });
  assert.equal(calls, 0);
});
