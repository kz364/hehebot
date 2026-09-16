// Diagnostic only: no I/O, grant issuance, tool registration or dispatch.
import catalog from '../config/connector-catalog.json' with { type: 'json' };

const whatsapp = structuredClone(catalog.whatsapp);
const fail = () => { throw Object.assign(new Error('INVALID_CONNECTOR_EVIDENCE'), { code: 'INVALID_CONNECTOR_EVIDENCE' }); };
const fields = ['advertised', 'installed', 'artifact', 'protocol', 'authorization'];

/** Classify one operation's host-observed evidence, never aggregate a connector's
 * tools into a connected flag. Evidence has no authenticity/freshness guarantee.
 * An observed authorization is historical, not permission for the next call.
 */
export function classifyConnectorReadiness(evidence) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(evidence)) ||
      Reflect.ownKeys(evidence).length !== fields.length ||
      !fields.every(key => Object.hasOwn(evidence, key) && 'value' in Object.getOwnPropertyDescriptor(evidence, key))) fail();
  const { advertised, installed, artifact, protocol, authorization } = evidence;
  if (typeof advertised !== 'boolean' || typeof installed !== 'boolean' ||
      !['unknown', 'verified', 'mismatch'].includes(artifact) ||
      !['unknown', 'incompatible', 'synthetic-verified', 'live-verified'].includes(protocol) ||
      !['not-checked', 'denied', 'observed-allowed'].includes(authorization)) fail();
  const missing = [];
  if (!advertised) missing.push('Operation is not advertised.');
  if (!installed) missing.push('Installation is not established.');
  if (artifact !== 'verified') missing.push(artifact === 'mismatch' ? 'Pinned artifact verification failed.' : 'Pinned artifact verification is missing.');
  if (protocol !== 'live-verified') missing.push(protocol === 'incompatible' ? 'Protocol result is incompatible; a reviewed fix and compatibility rerun are required.' :
    protocol === 'synthetic-verified' ? 'Only synthetic protocol evidence exists; live callability is unverified.' : 'Protocol callability is unverified.');
  if (authorization === 'denied') missing.push('The observed individual authorization was denied.');
  missing.push('Fresh Worker authorization for the exact task, attempt, tool and chat, with current lease/revocation and deadline checks, is required for every call.');
  return {
    evidence: { advertised, installed, artifact, protocol, authorization },
    missing,
    authority: 'not-granted',
    notificationsAvailable: false,
    mutationsAvailable: false,
    importedRoutinesSend: false,
    coverage: 'unknown',
  };
}

/** Model-facing pinned baseline, not a runtime probe. Includes the recent-read
 * blocker even for search so a partial success cannot imply history parity.
 */
export function describeWhatsAppReadiness(tool) {
  if (!['whatsapp_get_chat_messages', 'whatsapp_search_messages'].includes(tool)) fail();
  const result = classifyConnectorReadiness({ ...whatsapp.evidence, protocol: whatsapp.protocol[tool] });
  return { ...result, tool, evidenceScope: whatsapp.evidenceScope,
    missing: [...result.missing, ...whatsapp.prerequisites, whatsapp.protocol.recentReadBlocker] };
}
