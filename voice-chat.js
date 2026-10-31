import { voiceConfig } from "./voice-config.js";

let sdkPromise;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/livekit-client@2.23.0/dist/livekit-client.umd.min.js";
      script.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error("通話機能を読み込めませんでした。"));
      script.onerror = () => { sdkPromise = null; reject(new Error("通話機能を読み込めませんでした。")); };
      document.head.append(script);
    });
  }
  return sdkPromise;
}

export function createVoiceChat(getIdToken) {
  const panel = document.createElement("section");
  panel.className = "voice-panel";
  panel.innerHTML = '<h3>ボイスチャット</h3><p class="voice-status" role="status"></p><button class="secondary-button voice-join" type="button">通話に参加</button> <button class="secondary-button voice-mute" type="button" hidden>マイクをミュート</button><div class="voice-audio"></div>';
  const status = panel.querySelector(".voice-status");
  const join = panel.querySelector(".voice-join");
  const mute = panel.querySelector(".voice-mute");
  const audioContainer = panel.querySelector(".voice-audio");
  let context = null;
  let wanted = false;
  let muted = false;
  let room = null;
  let generation = 0;
  let connecting = false;
  let connected = false;

  function allowed() {
    return context && context.connected !== false && ["waiting", "finished"].includes(context.status);
  }

  function render(message) {
    panel.hidden = !context;
    join.disabled = !voiceConfig.tokenEndpoint || (connecting && !wanted);
    join.textContent = wanted ? "通話から退出" : "通話に参加";
    mute.hidden = !wanted || !connected;
    mute.disabled = connecting;
    mute.textContent = muted ? "マイクをオン" : "マイクをミュート";
    mute.setAttribute("aria-pressed", String(muted));
    status.textContent = message || (!voiceConfig.tokenEndpoint ? "通話は設定準備中です。" : !allowed() ? "ゲーム中は通話を切断します。結果画面で再接続します。" : wanted ? "通話に接続しています…" : "参加するとマイクを使用します。イヤホンの利用をおすすめします。");
  }

  function disconnect() {
    generation += 1;
    connecting = false;
    connected = false;
    const previous = room;
    room = null;
    if (previous) previous.disconnect().catch(() => undefined);
    audioContainer.replaceChildren();
  }

  async function connect() {
    if (!wanted || !allowed() || room || connecting || !voiceConfig.tokenEndpoint) return;
    const currentGeneration = ++generation;
    const currentContext = { ...context };
    connecting = true;
    render();
    try {
      const sdk = await loadSdk();
      const idToken = await getIdToken();
      const response = await fetch(voiceConfig.tokenEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ roomCode: currentContext.code, session: currentContext.session }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "通話への参加を許可できませんでした。");
      if (generation !== currentGeneration) return;
      const nextRoom = new sdk.Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      room = nextRoom;
      nextRoom.on(sdk.RoomEvent.TrackSubscribed, (track) => {
        if (room !== nextRoom || track.kind !== sdk.Track.Kind.Audio) return;
        const element = track.attach();
        audioContainer.append(element);
      });
      nextRoom.on(sdk.RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((element) => element.remove()); });
      nextRoom.on(sdk.RoomEvent.Reconnecting, () => { if (room === nextRoom) render("再接続しています…"); });
      nextRoom.on(sdk.RoomEvent.Reconnected, () => { if (room === nextRoom) render("通話に参加中です。"); });
      nextRoom.on(sdk.RoomEvent.Disconnected, () => {
        if (room !== nextRoom) return;
        disconnect();
        wanted = false;
        render("通話が切断されました。再度参加してください。");
      });
      await nextRoom.connect(data.serverUrl, data.token);
      if (generation !== currentGeneration) { await nextRoom.disconnect(); return; }
      await nextRoom.localParticipant.setMicrophoneEnabled(!muted);
      if (generation !== currentGeneration) { await nextRoom.disconnect(); return; }
      await nextRoom.startAudio();
      connecting = false;
      connected = true;
      render("通話に参加中です。");
    } catch (error) {
      if (generation !== currentGeneration) return;
      disconnect();
      wanted = false;
      render(error.name === "NotAllowedError" ? "マイクの使用を許可して、もう一度参加してください。" : `通話に接続できませんでした：${error.message}`);
    }
  }

  join.addEventListener("click", () => {
    wanted = !wanted;
    if (!wanted) disconnect(); else connect();
    render();
  });
  mute.addEventListener("click", async () => {
    if (!room || !connected) return;
    const currentRoom = room;
    mute.disabled = true;
    try {
      await currentRoom.localParticipant.setMicrophoneEnabled(muted);
      if (room !== currentRoom) return;
      muted = !muted;
      render("通話に参加中です。");
    } catch { render("マイクを切り替えられませんでした。マイクの許可を確認してください。"); }
  });

  return {
    update(nextContext, container) {
      const changed = context && nextContext && (context.code !== nextContext.code || context.session !== nextContext.session);
      context = nextContext;
      if (!context || changed) { wanted = false; disconnect(); }
      if (container) container.append(panel);
      if (!allowed()) { if (room || connecting) disconnect(); }
      render(connected ? "通話に参加中です。" : undefined);
      connect();
    },
    reset() { context = null; wanted = false; disconnect(); panel.hidden = true; },
  };
}
