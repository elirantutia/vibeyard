import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

interface McpResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

interface McpConnection {
  client: Client;
  transport: SSEClientTransport | StreamableHTTPClientTransport;
  closed: boolean;
}

interface McpEntry {
  generation: number;
  state: 'connecting' | 'connected';
  conn: McpConnection | null;
}

/** Bounded teardown: abandon an SDK close that hangs this long. */
const CLOSE_TIMEOUT_MS = 2000;

const connections = new Map<string, McpEntry>();
/** Resolve when `promise` settles or after `ms`, whichever comes first. Never rejects. */
function settleWithin(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/** Close a partially or fully created connection at most once, with a bounded timeout. */
function closeConnection(conn: McpConnection): Promise<void> {
  if (conn.closed) return Promise.resolve();
  conn.closed = true;
  const close = Promise.resolve()
    .then(() => conn.client.close())
    .catch(() => {
      // ignore close errors
    });
  return settleWithin(close, CLOSE_TIMEOUT_MS);
}

function getConnected(id: string): McpConnection | undefined {
  const entry = connections.get(id);
  if (!entry || entry.state !== 'connected' || !entry.conn) return undefined;
  return entry.conn;
}

export async function connect(id: string, url: string): Promise<McpResult> {
  const previous = connections.get(id);
  const entry: McpEntry = {
    generation: (previous?.generation ?? 0) + 1,
    state: 'connecting',
    conn: null,
  };
  connections.set(id, entry);
  if (previous?.conn) {
    void closeConnection(previous.conn);
  }

  let conn: McpConnection;
  try {
    const transport = url.endsWith('/sse')
      ? new SSEClientTransport(new URL(url))
      : new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: 'vibeyard-mcp-inspector', version: '1.0.0' });
    conn = { client, transport, closed: false };
  } catch (err) {
    if (connections.get(id) === entry) connections.delete(id);
    return { success: false, error: (err as Error).message };
  }

  // Publish before awaiting the handshake so a concurrent disconnect can find and close it.
  entry.conn = conn;

  try {
    await conn.client.connect(conn.transport);
  } catch (err) {
    if (connections.get(id) === entry) connections.delete(id);
    await closeConnection(conn);
    return { success: false, error: (err as Error).message };
  }

  if (connections.get(id) !== entry) {
    // A disconnect (or a newer connect) invalidated this attempt: close it
    // instead of installing a stale connection.
    await closeConnection(conn);
    return { success: false, error: 'Connection cancelled' };
  }

  entry.state = 'connected';
  return { success: true };
}

export async function disconnect(id: string): Promise<McpResult> {
  const entry = connections.get(id);
  if (!entry) return { success: true };
  connections.delete(id);
  if (entry.conn) {
    await closeConnection(entry.conn);
  }
  return { success: true };
}

export async function listTools(id: string): Promise<McpResult> {
  const conn = getConnected(id);
  if (!conn) return { success: false, error: 'Not connected' };
  try {
    const result = await conn.client.listTools();
    return { success: true, data: result.tools };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function listResources(id: string): Promise<McpResult> {
  const conn = getConnected(id);
  if (!conn) return { success: false, error: 'Not connected' };
  try {
    const result = await conn.client.listResources();
    return { success: true, data: result.resources };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function listPrompts(id: string): Promise<McpResult> {
  const conn = getConnected(id);
  if (!conn) return { success: false, error: 'Not connected' };
  try {
    const result = await conn.client.listPrompts();
    return { success: true, data: result.prompts };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function callTool(id: string, name: string, args: Record<string, unknown>): Promise<McpResult> {
  const conn = getConnected(id);
  if (!conn) return { success: false, error: 'Not connected' };
  try {
    const result = await conn.client.callTool({ name, arguments: args });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function readResource(id: string, uri: string): Promise<McpResult> {
  const conn = getConnected(id);
  if (!conn) return { success: false, error: 'Not connected' };
  try {
    const result = await conn.client.readResource({ uri });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getPrompt(id: string, name: string, args: Record<string, string>): Promise<McpResult> {
  const conn = getConnected(id);
  if (!conn) return { success: false, error: 'Not connected' };
  try {
    const result = await conn.client.getPrompt({ name, arguments: args });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function disconnectAll(): Promise<void> {
  const entries = [...connections.values()];
  connections.clear();
  await Promise.all(entries.filter((e) => e.conn).map((e) => closeConnection(e.conn!)));
}
