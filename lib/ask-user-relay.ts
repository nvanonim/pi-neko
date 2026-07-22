import { createServer, createConnection, type Server, type Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AskUserDetails, AskUserQuestion } from "./ask-user-state.ts";

export const ASK_USER_RELAY_ENV = "PI_ASK_USER_RELAY";
const MAX_MESSAGE_BYTES = 128 * 1024;

type RelayRequest = {
  questions: AskUserQuestion[];
};

type RelayResponse =
  | { ok: true; details: AskUserDetails }
  | { ok: false; error: string };

export interface AskUserRelayServer {
  address: string;
  close(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function send(socket: Socket, response: RelayResponse): void {
  socket.end(`${JSON.stringify(response)}\n`);
}

function readOneJsonLine<T>(socket: Socket, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("end", onEnd);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const onError = (error: Error) => finish(() => reject(error));
    const onEnd = () => finish(() => reject(new Error("ask_user relay closed without a response")));
    const onAbort = () => {
      socket.destroy();
      finish(() => reject(new Error("ask_user relay cancelled")));
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      if (Buffer.byteLength(buffer) > MAX_MESSAGE_BYTES) {
        socket.destroy();
        finish(() => reject(new Error("ask_user relay message exceeds 128KB")));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      finish(() => {
        try {
          resolve(JSON.parse(line) as T);
        } catch {
          reject(new Error("ask_user relay returned invalid JSON"));
        }
      });
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function startAskUserRelay(
  handle: (questions: AskUserQuestion[], signal: AbortSignal) => Promise<AskUserDetails>,
): Promise<AskUserRelayServer> {
  const sockets = new Set<Socket>();
  let socketDir: string | undefined;
  const address = process.platform === "win32"
    ? `\\\\.\\pipe\\pi-ask-user-${process.pid}-${randomUUID()}`
    : await (async () => {
        socketDir = await mkdtemp(`/tmp/pi-au-${process.pid}-`);
        return `${socketDir}/relay.sock`;
      })();

  const server: Server = createServer((socket) => {
    const controller = new AbortController();
    sockets.add(socket);
    socket.on("error", () => {
      /* Client disconnects are reported through the abort signal. */
    });
    socket.once("close", () => {
      sockets.delete(socket);
      controller.abort();
    });
    void readOneJsonLine<RelayRequest>(socket)
      .then(async (request) => {
        if (!request || !Array.isArray(request.questions)) {
          throw new Error("ask_user relay request is missing questions");
        }
        send(socket, { ok: true, details: await handle(request.questions, controller.signal) });
      })
      .catch((error) => send(socket, { ok: false, error: errorMessage(error) }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(address, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  return {
    address,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (socketDir) await rm(socketDir, { recursive: true, force: true });
    },
  };
}

export async function requestAskUserRelay(
  address: string,
  questions: AskUserQuestion[],
  signal?: AbortSignal,
): Promise<AskUserDetails> {
  if (signal?.aborted) throw new Error("ask_user relay cancelled");
  const socket = createConnection(address);
  const responsePromise = readOneJsonLine<RelayResponse>(socket, signal);
  socket.write(`${JSON.stringify({ questions } satisfies RelayRequest)}\n`);
  const response = await responsePromise;
  socket.destroy();
  if (!response.ok) throw new Error(`ask_user relay failed: ${response.error}`);
  return response.details;
}
