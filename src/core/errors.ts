export class ControlError extends Error {
  constructor(public code: string, message: string, public status = 409, public retryable = false) {
    super(message); this.name = 'ControlError';
  }
}
export function requireThat(condition: unknown, code: string, message: string, status = 409): asserts condition {
  if (!condition) throw new ControlError(code, message, status);
}
export function safeError(error: unknown) {
  if (error instanceof ControlError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: 'INTERNAL_ERROR', message: 'The request could not be completed.', retryable: true };
}
