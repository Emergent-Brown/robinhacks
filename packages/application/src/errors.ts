export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
export function requireState(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ApplicationError(code, message);
}
