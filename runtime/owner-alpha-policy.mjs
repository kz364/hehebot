const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Operator-selected local session bounds, never a model-supplied grant. */
export function ownerAlphaPolicy(value) {
  const keys = ['session_id', 'persona_id', 'expires_at', 'max_runs', 'max_task_seconds'];
  if (value && Object.hasOwn(value, 'background_first_root')) keys.push('background_first_root');
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key)) ||
      keys.includes('background_first_root') && value.background_first_root !== true ||
      typeof value.session_id !== 'string' || !uuid.test(value.session_id) ||
      typeof value.persona_id !== 'string' || !uuid.test(value.persona_id) ||
      typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at)) ||
      new Date(value.expires_at).toISOString() !== value.expires_at ||
      !Number.isInteger(value.max_runs) || value.max_runs < 1 || value.max_runs > 3 ||
      !Number.isInteger(value.max_task_seconds) || value.max_task_seconds < 1 || value.max_task_seconds > 300) {
    throw Object.assign(new Error('INVALID_OWNER_ALPHA_POLICY'), { code: 'INVALID_OWNER_ALPHA_POLICY' });
  }
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
