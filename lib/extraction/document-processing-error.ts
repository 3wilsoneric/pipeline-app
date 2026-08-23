export class DocumentProcessingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 410 | 413 | 415 | 502 | 503 = 400,
    message = code,
  ) {
    super(message);
    this.name = "DocumentProcessingError";
  }
}
