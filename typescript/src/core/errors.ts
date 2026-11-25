/** Error thrown by the SDK. `status` is set when Mission Control answered with a non-2xx response. */
export class MissionControlError extends Error {
  readonly status?: number;

  constructor(message: string, options: { status?: number } = {}) {
    super(`mission-control-sdk: ${message}`);
    this.name = "MissionControlError";
    this.status = options.status;
  }
}
