import { createServer } from "node:http";

// A local stand-in for Cerebras. Tests point CEREBRAS_BASE_URL at it, so the
// streamer, its chain and its failure handling run for real without a key.
export async function startFakeProvider(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method, url: req.url, body });

    const reply = await handler({ url: req.url, body });
    if (reply?.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const piece of reply.stream) res.write(piece);
      res.end();
      return;
    }
    res.writeHead(reply?.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply?.body ?? {}));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

// Two content deltas, a finish chunk carrying usage, then the terminator. Split
// into pieces so the streamer has to reassemble them rather than read one blob.
export const contentStream = (
  text,
  usage = { prompt_tokens: 11, completion_tokens: 5 }
) => [
  sse({ choices: [{ delta: { content: text.slice(0, 3) } }] }),
  sse({ choices: [{ delta: { content: text.slice(3) } }] }),
  sse({ choices: [{ delta: {}, finish_reason: "stop" }], usage }),
  "data: [DONE]\n\n",
];
