function json(value, status, origin) {
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Vary": "Origin",
  } });
}

function encode(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createToken(env, uid, roomName, name) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: env.LIVEKIT_API_KEY, sub: uid, name, nbf: now - 5, exp: now + 120,
    video: { roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: ["microphone"] },
  };
  const content = `${encode(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${encode(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LIVEKIT_API_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return `${content}.${encode(signature)}`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://vectorpattern.github.io";
    if (origin !== allowedOrigin) return new Response("Forbidden", { status: 403 });
    if (request.method === "OPTIONS") return json({}, 204, origin);
    if (request.method !== "POST") return json({ error: "POSTで接続してください。" }, 405, origin);
    if (![env.LIVEKIT_URL, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, env.FIREBASE_API_KEY, env.FIREBASE_DATABASE_URL].every(Boolean)) return json({ error: "通話サーバーの設定が未完了です。" }, 503, origin);
    const idToken = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!idToken) return json({ error: "ログインが必要です。" }, 401, origin);
    let body;
    try { body = await request.json(); } catch { return json({ error: "入力形式が正しくありません。" }, 400, origin); }
    if (!/^[A-Z0-9]{6}$/.test(body?.roomCode) || !Number.isSafeInteger(body?.session)) return json({ error: "ルーム情報が正しくありません。" }, 400, origin);
    try {
      const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }), signal: AbortSignal.timeout(10000),
      });
      if (!authResponse.ok) return json({ error: "ログインを確認できません。再入室してください。" }, 401, origin);
      const user = (await authResponse.json()).users?.[0];
      if (!user?.localId || user.disabled) return json({ error: "ログインが無効です。" }, 401, origin);
      const roomUrl = new URL(`${env.FIREBASE_DATABASE_URL.replace(/\/$/, "")}/rooms/${body.roomCode}.json`);
      roomUrl.searchParams.set("auth", idToken);
      const roomResponse = await fetch(roomUrl, { signal: AbortSignal.timeout(10000) });
      if (!roomResponse.ok) return json({ error: "ルーム情報を確認できません。" }, 403, origin);
      const room = await roomResponse.json();
      const player = room?.players?.[user.localId];
      if (!player || player.connected === false || room.createdAt !== body.session) return json({ error: "この対戦の参加者だけが通話できます。" }, 403, origin);
      if (!["waiting", "finished"].includes(room.status)) return json({ error: "ゲーム中は通話を休止しています。" }, 409, origin);
      const token = await createToken(env, user.localId, `${body.roomCode}-${room.createdAt}`, String(player.name || "プレイヤー").slice(0, 12));
      return json({ token, serverUrl: env.LIVEKIT_URL }, 200, origin);
    } catch {
      return json({ error: "通話の接続準備に失敗しました。もう一度お試しください。" }, 502, origin);
    }
  },
};
