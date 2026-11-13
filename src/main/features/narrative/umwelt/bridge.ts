import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';

/** A failed engine request, carrying the protocol code (`NOT_FOUND`, `CONFLICT`, `VALIDATION_FAILED`...). */
export class UmweltRequestError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'UmweltRequestError';
  }
}

export interface UmweltBridgeOptions {
  /** An `umwelt` executable to run instead of the one bundled with the client. */
  binary?: string;
  /** How long one request may take, the first one of a file included (it starts the engine). */
  timeoutMs?: number;
  /** Files kept open at once; opening one more closes the least recently used. */
  maxOpenFiles?: number;
}

interface Reply {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

// The official client is asynchronous; it runs in a worker so the main process can wait for each
// answer the way it already waits for SQLite.
const WORKER_SOURCE = `
const { workerData } = require('node:worker_threads');
const { existsSync } = require('node:fs');
const { port, signal, clientUrl, binary } = workerData;
const flag = new Int32Array(signal);
const clients = new Map();
const diagnostics = new Map();
let module;
async function open(file) {
  let client = clients.get(file);
  if (client) return client;
  module = module || await import(clientUrl);
  const onStderr = text => diagnostics.set(file, String(text).trim().slice(-500));
  client = module.createClient({ file, create: !existsSync(file), client: 'kallamo', onStderr, ...(binary ? { binary } : {}) });
  clients.set(file, client);
  try { await client.transport.ready; } catch (error) { clients.delete(file); throw error; }
  return client;
}
function reply(message) {
  port.postMessage(message);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}
port.on('message', async message => {
  try {
    if (message.kind === 'close') {
      const client = clients.get(message.file);
      clients.delete(message.file);
      if (client) await client.close().catch(() => {});
      reply({ id: message.id, ok: true });
      return;
    }
    const client = await open(message.file);
    const result = await client.transport.request(message.op, message.payload);
    reply({ id: message.id, ok: true, result });
  } catch (error) {
    let text = String((error && error.message) || error);
    if (error && error.code === 'TRANSPORT_CLOSED') {
      clients.delete(message.file);
      // Why the engine stopped is only on its stderr.
      if (diagnostics.get(message.file)) text += ' ' + diagnostics.get(message.file);
    }
    reply({ id: message.id, ok: false, error: { code: (error && error.code) || 'INTERNAL', message: text, details: error && error.details } });
  }
});
`;

/** Finds the client's entry point; inside a packaged app it is read from the unpacked copy. */
export function resolveClientEntry(start = __dirname): string {
  const unpacked = (path: string) => path.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  let directory = start;
  for (;;) {
    const candidate = join(directory, 'node_modules', '@kallamo', 'umwelt', 'dist', 'index.js');
    if (existsSync(unpacked(candidate))) return unpacked(candidate);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('The Umwelt client (@kallamo/umwelt) is not installed.');
}

/**
 * Synchronous access to Umwelt files. Every call blocks until the engine answers, so a caller can
 * read and write story state from the same code paths that use better-sqlite3.
 */
export class UmweltBridge {
  private worker: Worker | null = null;
  private port: MessagePort | null = null;
  private signal: Int32Array | null = null;
  private sequence = 0;
  private readonly open: string[] = [];
  private readonly timeoutMs: number;
  private readonly maxOpenFiles: number;

  constructor(private readonly options: UmweltBridgeOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxOpenFiles = Math.max(1, options.maxOpenFiles ?? 4);
  }

  call<T>(file: string, op: string, payload: unknown): T {
    this.touch(file);
    return this.send<T>({ kind: 'request', file, op, payload });
  }

  /** Shuts the engine of one file down, so the file can be copied, moved or deleted. */
  close(file: string): void {
    const index = this.open.indexOf(file);
    if (index < 0) return;
    this.open.splice(index, 1);
    this.send({ kind: 'close', file });
  }

  closeAll(): void {
    for (const file of [...this.open]) {
      try { this.close(file); } catch { /* the engine of that file is already gone */ }
    }
  }

  isOpen(file: string): boolean {
    return this.open.includes(file);
  }

  dispose(): void {
    this.closeAll();
    void this.worker?.terminate();
    this.worker = null;
    this.port = null;
    this.signal = null;
  }

  private touch(file: string): void {
    const index = this.open.indexOf(file);
    if (index >= 0) this.open.splice(index, 1);
    this.open.push(file);
    while (this.open.length > this.maxOpenFiles) {
      const oldest = this.open.shift()!;
      try { this.send({ kind: 'close', file: oldest }); } catch { /* reopened on its next use */ }
    }
  }

  private start(): void {
    if (this.worker) return;
    const channel = new MessageChannel();
    const shared = new SharedArrayBuffer(4);
    this.signal = new Int32Array(shared);
    const binary = this.options.binary ?? process.env.UMWELT_BINARY;
    this.worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        port: channel.port2,
        signal: shared,
        clientUrl: pathToFileURL(resolveClientEntry()).href,
        ...(binary ? { binary } : {})
      },
      transferList: [channel.port2]
    });
    this.worker.unref();
    this.port = channel.port1;
    this.port.unref();
  }

  private send<T>(message: Record<string, unknown>): T {
    this.start();
    const id = ++this.sequence;
    Atomics.store(this.signal!, 0, 0);
    this.port!.postMessage({ ...message, id });
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const received = receiveMessageOnPort(this.port!);
      if (received) {
        const reply = received.message as Reply;
        if (reply.id !== id) continue;
        if (reply.ok) return reply.result as T;
        throw new UmweltRequestError(reply.error?.code ?? 'INTERNAL', reply.error?.message ?? 'Umwelt request failed.', reply.error?.details);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        // A worker that stopped answering cannot be trusted with the next request.
        void this.worker?.terminate();
        this.worker = null;
        this.open.length = 0;
        throw new UmweltRequestError('TIMEOUT', `Umwelt did not answer ${String(message.op ?? message.kind)} in time.`);
      }
      Atomics.wait(this.signal!, 0, 0, remaining);
      Atomics.store(this.signal!, 0, 0);
    }
  }
}

// One bridge per process, even when this module is loaded twice (the compiled copy the app's
// JavaScript requires, and the TypeScript source the tests import).
const BRIDGE_KEY = Symbol.for('kallamo.umwelt.bridge');
type BridgeHolder = { [BRIDGE_KEY]?: UmweltBridge | null };

export function getUmweltBridge(): UmweltBridge {
  const holder = globalThis as BridgeHolder;
  holder[BRIDGE_KEY] ??= new UmweltBridge();
  return holder[BRIDGE_KEY]!;
}

/** Replaces the process-wide bridge and disposes the previous one. */
export function setUmweltBridge(bridge: UmweltBridge | null): void {
  const holder = globalThis as BridgeHolder;
  holder[BRIDGE_KEY]?.dispose();
  holder[BRIDGE_KEY] = bridge;
}
