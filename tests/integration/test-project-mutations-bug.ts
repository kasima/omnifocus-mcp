#!/usr/bin/env node
// Integration test for the project mutation bugs:
//   - update_project status=dropped/done failed (app.Project.Status.* undefined)
//   - delete_project failed with "Parameter is missing" (project.remove() invalid)
// Verifies the fixes against a live OmniFocus.

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
server.stderr.on('data', () => {});

let nextId = 1;
const pending = new Map<number, (r: JsonRpcResponse) => void>();
rl.on('line', (line: string) => {
  if (!line.trim().startsWith('{')) return;
  try {
    const msg: JsonRpcResponse = JSON.parse(line);
    const cb = pending.get(msg.id);
    if (cb) { pending.delete(msg.id); cb(msg); }
  } catch {}
});

function call(method: string, params: any = {}): Promise<JsonRpcResponse> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n');
  });
}

async function callTool(name: string, args: any): Promise<any> {
  const r = await call('tools/call', { name, arguments: args });
  if (r.error) return { error: true, message: r.error.message };
  const text = r.result?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function main() {
  await call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'project-bug-test', version: '1.0' },
  });

  const stamp = Date.now();
  let pass = 0;
  let fail = 0;
  const log = (label: string, ok: boolean, detail: string) => {
    const mark = ok ? '✅' : '❌';
    console.log(`${mark} ${label}: ${detail}`);
    ok ? pass++ : fail++;
  };

  // Helper: create a fresh project for each status test
  const createProj = async (suffix: string): Promise<string | null> => {
    const r = await callTool('create_project', { name: `_mcp_proj_test_${stamp}_${suffix}` });
    return r?.project?.id ?? r?.projectId ?? r?.id ?? null;
  };

  // 1) status: active (should round-trip)
  let id = await createProj('active');
  log('create proj for active', !!id, String(id));
  let r = await callTool('update_project', { projectId: id, updates: { status: 'active' } });
  log('update status=active', !r.error && r.success, JSON.stringify(r));
  await callTool('delete_project', { projectId: id, deleteTasks: true });

  // 2) status: onHold
  id = await createProj('onHold');
  r = await callTool('update_project', { projectId: id, updates: { status: 'onHold' } });
  log('update status=onHold', !r.error && r.success, JSON.stringify(r));
  await callTool('delete_project', { projectId: id, deleteTasks: true });

  // 3) status: dropped (the originally broken case)
  id = await createProj('dropped');
  r = await callTool('update_project', { projectId: id, updates: { status: 'dropped' } });
  log('update status=dropped', !r.error && r.success, JSON.stringify(r));
  await callTool('delete_project', { projectId: id, deleteTasks: true });

  // 4) status: done
  id = await createProj('done');
  r = await callTool('update_project', { projectId: id, updates: { status: 'done' } });
  log('update status=done', !r.error && r.success, JSON.stringify(r));
  await callTool('delete_project', { projectId: id, deleteTasks: true });

  // 5) delete_project (the originally broken case) — also verifies cleanup deletes above worked
  id = await createProj('delete');
  log('create proj for delete', !!id, String(id));
  r = await callTool('delete_project', { projectId: id, deleteTasks: true });
  log('delete_project', !r.error && r.success, JSON.stringify(r));

  console.log(`\n${pass} passed, ${fail} failed`);
  server.kill();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); server.kill(); process.exit(1); });
