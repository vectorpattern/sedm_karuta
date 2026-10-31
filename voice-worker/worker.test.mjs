import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("worker.js", import.meta.url), "utf8");
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("通話トークンは認証済み参加者に限定し、ゲーム中と別対戦へのアクセスを拒否する", async () => {
  const origin = "https://vectorpattern.github.io";
  const env = {
    ALLOWED_ORIGIN: origin, LIVEKIT_URL: "wss://test.livekit.cloud", LIVEKIT_API_KEY: "test-key",
    LIVEKIT_API_SECRET: "test-secret-not-real", FIREBASE_API_KEY: "firebase-test",
    FIREBASE_DATABASE_URL: "https://example.firebaseio.com",
  };
  let room = { createdAt: 123, status: "waiting", players: { user1: { name: "Player", connected: true } } };
  let validUser = true;
  const request = (body = { roomCode: "SEDM01", session: 123 }, authenticated = true) => new Request("https://test.workers.dev", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer fake-id-token" } : {}) },
    body: JSON.stringify(body),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes("accounts:lookup")
    ? Response.json(validUser ? { users: [{ localId: "user1" }] } : {}, { status: validUser ? 200 : 400 })
    : Response.json(room);
  try {
    assert.equal((await worker.fetch(new Request("https://test.workers.dev", { method: "OPTIONS", headers: { Origin: origin } }), env)).status, 204);
    assert.equal((await worker.fetch(new Request("https://test.workers.dev", { headers: { Origin: "https://other.example" } }), env)).status, 403);
    assert.equal((await worker.fetch(request(undefined, false), env)).status, 401);
    assert.equal((await worker.fetch(request({ roomCode: "BAD", session: 123 }), env)).status, 400);
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const data = await response.json();
    const [header, payload, signature] = data.token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.sub, "user1");
    assert.equal(claims.video.room, "SEDM01-123");
    assert.deepEqual(claims.video.canPublishSources, ["microphone"]);
    assert.equal(claims.video.canPublishData, false);
    assert.equal(claims.video.roomAdmin, undefined);
    assert(claims.exp - claims.nbf <= 125);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LIVEKIT_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    assert(await crypto.subtle.verify("HMAC", key, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${header}.${payload}`)));
    room.status = "playing";
    assert.equal((await worker.fetch(request(), env)).status, 409);
    room.status = "finished";
    assert.equal((await worker.fetch(request(), env)).status, 200);
    assert.equal((await worker.fetch(request({ roomCode: "SEDM01", session: 456 }), env)).status, 403);
    room.players.user1.connected = false;
    assert.equal((await worker.fetch(request(), env)).status, 403);
    room.players = {};
    assert.equal((await worker.fetch(request(), env)).status, 403);
    validUser = false;
    assert.equal((await worker.fetch(request(), env)).status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
