export class DhanConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DhanConfigError";
  }
}

export class DhanApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DhanApiError";
    this.status = status;
  }
}
