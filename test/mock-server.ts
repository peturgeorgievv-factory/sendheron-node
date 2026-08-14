import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export interface ScriptedResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  /** Sent verbatim: for non-JSON responses like an edge/proxy error page. */
  rawBody?: string;
  /** Destroy the socket instead of responding: a network failure. */
  destroy?: boolean;
  /** Send headers and half the body, then destroy: a truncated response. */
  destroyMidBody?: boolean;
  /** Never respond: a hung upstream. */
  hang?: boolean;
}

export interface MockServer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/**
 * A real HTTP server per test, no mocking libraries: the retry and
 * idempotency behavior under test lives in how the client talks to a socket,
 * which fetch-stubbing would assume away. Responses are served in order;
 * the last one repeats.
 */
export async function startMockServer(
  responses: ScriptedResponse[],
): Promise<MockServer> {
  const requests: CapturedRequest[] = [];
  let index = 0;

  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
      });

      const scripted = responses[Math.min(index, responses.length - 1)] ?? {};
      index++;

      if (scripted.destroy) {
        req.socket.destroy();
        return;
      }

      if (scripted.hang) {
        return;
      }

      if (scripted.destroyMidBody) {
        res.writeHead(scripted.status ?? 200, {
          'content-type': 'application/json',
          'content-length': '1000',
        });
        res.write('{"partial":');
        req.socket.destroy();
        return;
      }

      res.writeHead(scripted.status ?? 200, {
        'content-type': 'application/json',
        ...(scripted.headers ?? {}),
      });
      res.end(
        scripted.rawBody ??
          (scripted.body === undefined ? '' : JSON.stringify(scripted.body)),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
