#!/usr/bin/env node
// Integration test for the manage_tags bug:
//   delete + merge actions failed with "Parameter is missing"
// Reproduces against a live OmniFocus and verifies the fix.

import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: { code: number; message: string };
  id: number;
}

const server: ChildProcessWithoutNullStreams = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, LOG_LEVEL: 'error' },
});

const rl = createInterface({ input: server.stdout, crlfDelay: Infinity });

let nextId = 1;
const pending = new Map<number, (r: JsonRpcResponse) => void>();

rl.on('line', (line: string) => {
  if (!line.trim().startsWith('{')) return;
  try {
    const msg: JsonRpcResponse = JSON.parse(line);
    const cb = pending.get(msg.id);
    if (cb) {
      pending.delete(msg.id);
      cb(msg);
    }
  } catch {}
});

server.stderr.on('data', () => {}); // suppress

function call(method: string, params: any = {}): Promise<JsonRpcResponse> {
  const id = nextId++;
  const req = { jsonrpc: '2.0', method, params, id };
  return new Promise((resolve) => {
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify(req) + '\n');
  });
}

async function callTool(name: string, args: any): Promise<any> {
  const r = await call('tools/call', { name, arguments: args });
  if (r.error) return { error: true, message: r.error.message };
  // result.content[0].text is JSON-stringified
  const text = r.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function main() {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'bug-test', version: '1.0' },
  });

  const stamp = Date.now();
  const TAG_A = `_mcp_bug_test_${stamp}_a`;
  const TAG_B = `_mcp_bug_test_${stamp}_b`;
  const TAG_DEL = `_mcp_bug_test_${stamp}_del`;

  let pass = 0;
  let fail = 0;
  const log = (label: string, ok: boolean, detail: string) => {
    const mark = ok ? '✅' : '❌';
    console.log(`${mark} ${label}: ${detail}`);
    ok ? pass++ : fail++;
  };

  // 1) create
  let res = await callTool('manage_tags', { action: 'create', tagName: TAG_DEL });
  log('create TAG_DEL', !res.error, JSON.stringify(res));

  // 2) delete (the bug)
  res = await callTool('manage_tags', { action: 'delete', tagName: TAG_DEL });
  log('delete TAG_DEL', !res.error && res.success === true, JSON.stringify(res));

  // 3) create A and B for merge
  res = await callTool('manage_tags', { action: 'create', tagName: TAG_A });
  log('create TAG_A', !res.error, JSON.stringify(res));
  res = await callTool('manage_tags', { action: 'create', tagName: TAG_B });
  log('create TAG_B', !res.error, JSON.stringify(res));

  // 4) merge (the other half of the bug)
  res = await callTool('manage_tags', {
    action: 'merge',
    tagName: TAG_A,
    targetTag: TAG_B,
  });
  log('merge A→B', !res.error && res.success === true, JSON.stringify(res));

  // 5) cleanup TAG_B
  res = await callTool('manage_tags', { action: 'delete', tagName: TAG_B });
  log('cleanup TAG_B', !res.error && res.success === true, JSON.stringify(res));

  console.log(`\n${pass} passed, ${fail} failed`);
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
