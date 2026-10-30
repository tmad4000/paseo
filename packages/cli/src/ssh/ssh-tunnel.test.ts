import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const sinkDir = mkdtempSync(path.join(tmpdir(), "paseo-ssh-tunnel-"));
const sinkPath = path.join(sinkDir, "remote.log");

// Stand in for `ssh -W`: `tee` records what reached the "remote" side, echoes it back,
// and exits on stdin EOF, like ssh does when the forwarded connection finishes.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (_command: string, _args: string[], options: Parameters<typeof actual.spawn>[2]) =>
      actual.spawn("tee", [sinkPath], options),
  };
});

const { createSshTunnel } = await import("./ssh-tunnel.js");

const target = { host: "build-box", daemonPort: 7777 };
const sockets: Socket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
});

afterAll(() => {
  rmSync(sinkDir, { recursive: true, force: true });
});

async function openForwardedConnection(endpoint: string) {
  const [host, port] = endpoint.split(":");
  const socket = connect(Number(port), host);
  sockets.push(socket);
  let received = "";
  socket.on("data", (chunk: Buffer) => {
    received += chunk.toString();
  });
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  // Round-trip once so the tunnel has accepted the connection and started its child.
  socket.write("ready;");
  await expect.poll(() => received).toBe("ready;");
  return { socket, closed };
}

describe.skipIf(process.platform === "win32")("ssh tunnel close", () => {
  it("lets a frame written just before close finish crossing the tunnel", async () => {
    const tunnel = await createSshTunnel(target);
    const connection = await openForwardedConnection(tunnel.endpoint);

    // The client writes its last frame and starts closing in the same tick, then the
    // CLI tears the tunnel down. An immediate kill used to drop that frame.
    connection.socket.end("last-frame");
    const startedAt = Date.now();
    await tunnel.closeGracefully(5000);

    expect(Date.now() - startedAt).toBeLessThan(5000);
    await connection.closed;
    expect(readFileSync(sinkPath, "utf8")).toBe("ready;last-frame");
  });

  it("bounds the wait when the forwarded connection never finishes", async () => {
    const tunnel = await createSshTunnel(target);
    const connection = await openForwardedConnection(tunnel.endpoint);

    const startedAt = Date.now();
    await tunnel.closeGracefully(100);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
    await connection.closed;
  });

  it("closes at once when no connection was ever forwarded", async () => {
    const tunnel = await createSshTunnel(target);
    const startedAt = Date.now();
    await tunnel.closeGracefully(5000);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
