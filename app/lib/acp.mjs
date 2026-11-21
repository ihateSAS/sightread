import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

/**
 * A persistent OpenClaw ACP bridge.
 *
 * `openclaw agent --json` only prints the finished envelope, so the app could
 * not show a time-to-first-token. The ACP bridge speaks JSON-RPC over stdio and
 * emits `agent_message_chunk` notifications while the model is still writing,
 * which is what the Ask panel needs. Spawning the bridge costs ~1.8s, so it is
 * started once and reused; each question gets a fresh ACP session, which keeps
 * one ask's history out of the next one.
 */

const INIT_TIMEOUT_MS = 25_000;
const SESSION_TIMEOUT_MS = 15_000;
const ASK_TIMEOUT_MS = 90_000;

export function createAcpClient({
  bin = "openclaw",
  agent = "sightread",
  initTimeoutMs = INIT_TIMEOUT_MS,
  askTimeoutMs = ASK_TIMEOUT_MS,
} = {}) {
  let child = null;
  let ready = null;
  let seq = 0;
  let stderr = "";
  const pending = new Map();
  const listeners = new Set();

  function failAll(err) {
    for (const { reject, timer } of pending.values()) {
      if (timer) clearTimeout(timer);
      reject(err);
    }
    pending.clear();
    listeners.clear();
  }

  function handleLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg.id !== undefined && pending.has(msg.id)) {
      const slot = pending.get(msg.id);
      pending.delete(msg.id);
      if (slot.timer) clearTimeout(slot.timer);
      if (msg.error) slot.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else slot.resolve(msg.result);
      return;
    }

    if (msg.method === "session/update") {
      const update = msg.params?.update ?? {};
      for (const listener of listeners) listener(msg.params.sessionId, update);
    }
  }

  function request(method, params, timeoutMs) {
    if (!child) return Promise.reject(new Error("ACP bridge is not running"));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            pending.delete(id);
            reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
          }, timeoutMs)
        : null;
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  function ensure() {
    if (ready) return ready;
    ready = (async () => {
      stderr = "";
      const spawned = spawn(bin, ["acp", "--session", `agent:${agent}:acp-${randomUUID()}`], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      child = spawned;
      let buf = "";
      child.stdout.on("data", (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) handleLine(line);
        }
      });
      child.stderr.on("data", (d) => {
        stderr = (stderr + d.toString()).slice(-2000);
      });
      // A closed question's process exits while the next question is already
      // starting, so its exit must not tear down the bridge that replaced it.
      spawned.on("close", () => {
        if (child !== spawned) return;
        child = null;
        ready = null;
        failAll(new Error("ACP bridge closed"));
      });
      spawned.on("error", (e) => {
        if (child !== spawned) return;
        child = null;
        ready = null;
        failAll(e);
      });
      await request("initialize", { protocolVersion: 1, clientCapabilities: {} }, initTimeoutMs);
    })();
    // A failed start must not leave a rejected promise cached forever.
    ready.catch(() => {
      ready = null;
    });
    return ready;
  }

  /**
   * One question, one bridge.
   *
   * ACP sessions created on the same bridge share one gateway session: a word
   * told to the first session was recalled by the second. That would let the
   * "no graph" answer read the aided turn, which is exactly the comparison the
   * product makes. A fresh bridge and session key per question is the only
   * isolation the bridge offers; it costs its ~1.2s start.
   *
   * onChunk fires per streamed delta, before the turn finishes.
   */
  async function ask({ prompt, cwd, thinking, onChunk, timeoutMs = askTimeoutMs }) {
    close();
    let listener = null;
    try {
      await ensure();
      const session = await request("session/new", { cwd, mcpServers: [] }, SESSION_TIMEOUT_MS);
      const sessionId = session?.sessionId;
      if (!sessionId) throw new Error("ACP bridge returned no session id");

      // ACP starts at "adaptive", which follows the gateway default and spends
      // more reasoning tokens than an answer grounded in parsed imports needs.
      // The page's level maps onto the advertised thought_level modes.
      if (thinking && thinking !== "adaptive") {
        await request("session/set_mode", { sessionId, modeId: thinking }, 5_000).catch(() => {});
      }

      let toolCalls = 0;
      listener = (sid, update) => {
        if (sid !== sessionId) return;
        if (update.sessionUpdate === "agent_message_chunk") {
          const text = update.content?.text ?? "";
          if (text) onChunk?.(text);
        } else if (update.sessionUpdate === "tool_call") {
          toolCalls += 1;
        }
      };
      listeners.add(listener);
      const started = performance.now();
      const result = await request(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text: prompt }] },
        timeoutMs
      );
      return {
        sessionId,
        toolCalls,
        stopReason: result?.stopReason ?? null,
        elapsedMs: Math.round(performance.now() - started),
      };
    } finally {
      if (listener) listeners.delete(listener);
      close();
    }
  }

  function warm() {
    return ensure().catch(() => {});
  }

  function close() {
    if (!child) return;
    const dying = child;
    child = null;
    ready = null;
    dying.kill("SIGKILL");
    failAll(new Error("ACP bridge stopped"));
  }

  return { ask, warm, close, lastStderr: () => stderr };
}
