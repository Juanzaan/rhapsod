import type { IncomingMessage, ServerResponse } from "node:http";

export function createCallbackHandler(options: {
  state: string;
  onCode: (code: string, response: ServerResponse) => void;
  onError: (error: string) => void;
}): (request: IncomingMessage, response: ServerResponse) => void;
