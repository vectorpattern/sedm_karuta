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

export function createVoiceChat(getIdToken, onVoiceActive = () => {}) {
  const panel = document.createElement("section");
  panel.className = "voice-panel";
  panel.innerHTML = '<h3>ボイスチャット</h3><p class="voice-status" role="status"></p><button class="secondary-button voice-join" type="button">通話に参加</button> <button class="secondary-button voice-mute" type="button" hidden>マイクをミュート</button> <button class="secondary-button voice-play" type="button" hidden>相手の音声を再生</button><div class="voice-audio"></div>';
  const status = panel.querySelector(".voice-status");
  const join = panel.querySelector(".voice-join");
  const mute = panel.querySelector(".voice-mute");
  const play = panel.querySelector(".voice-play");
  const audioContainer = panel.querySelector(".voice-audio");
  let receiveVolume = 0.15;
  const volumeLabel = document.createElement("label");
  volumeLabel.className = "voice-volume";
  volumeLabel.innerHTML = '通話音量 <input type="range" min="0" max="100" value="15" aria-label="通話の受信音量"> <span>15%</span>';
  panel.insertBefore(volumeLabel, audioContainer);
  volumeLabel.querySelector("input").addEventListener("input", (event) => {
    receiveVolume = Number(event.target.value) / 100;
    volumeLabel.querySelector("span").textContent = `${event.target.value}%`;
    audioContainer.querySelectorAll("audio").forEach((element) => { element.volume = receiveVolume; });
  });
  let context = null;
  let wanted = false;
  let muted = false;
  let room = null;
  let generation = 0;
  let connecting = false;
  let connected = false;

  function allowed() {
    return context && context.connected !== false && ["waiting", "playing", "finished"].includes(context.status);
  }

  function render(message) {
    onVoiceActive(wanted && Boolean(allowed()));
    panel.hidden = !context;
    join.disabled = !voiceConfig.tokenEndpoint || (connecting && !wanted);
    join.textContent = wanted ? "通話から退出" : "通話に参加";
    mute.hidden = !wanted || !connected;
    mute.disabled = connecting;
    mute.textContent = muted ? "マイクをオン" : "マイクをミュート";
    mute.setAttribute("aria-pressed", String(muted));
    play.hidden = !connected;
    status.textContent = message || (!voiceConfig.tokenEndpoint ? "通話は設定準備中です。" : !allowed() ? "対戦に参加すると通話できます。" : wanted ? "通話に接続しています…" : "ゲーム中も通話できます。読み上げの回り込みを防ぐため、イヤホンの利用をおすすめします。");
    if (connected && room) {
      status.textContent += ` 通話${room.remoteParticipants.size + 1}人 ／ 自分のマイク${muted ? "OFF" : "ON"}`;
      if (!room.canPlaybackAudio) status.textContent += " 「相手の音声を再生」を押してください。";
    }
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
    let disconnectDetail = "";
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
      if (typeof data.serverUrl !== "string" || !/^wss:\/\/[^\s/]+\/?$/.test(data.serverUrl)) {
        throw new Error("CloudflareのLIVEKIT_URLを確認してください。wss://で始まるLiveKitのProject URLが必要です。");
      }
      const nextRoom = new sdk.Room({ audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      room = nextRoom;
      nextRoom.on(sdk.RoomEvent.TrackSubscribed, (track) => {
        if (room !== nextRoom || track.kind !== sdk.Track.Kind.Audio) return;
        const element = track.attach();
        element.autoplay = true;
        element.muted = false;
        element.volume = receiveVolume;
        audioContainer.append(element);
        element.play().catch(() => render("音声の再生が止められています。「相手の音声を再生」を押してください。"));
      });
      nextRoom.on(sdk.RoomEvent.TrackUnsubscribed, (track) => { track.detach().forEach((element) => element.remove()); });
      nextRoom.on(sdk.RoomEvent.Reconnecting, () => { if (room === nextRoom) render("再接続しています…"); });
      nextRoom.on(sdk.RoomEvent.Reconnected, () => { if (room === nextRoom) render("通話に参加中です。"); });
      nextRoom.on(sdk.RoomEvent.ParticipantConnected, () => { if (room === nextRoom && connected) render("通話に参加中です。"); });
      nextRoom.on(sdk.RoomEvent.ParticipantDisconnected, () => { if (room === nextRoom && connected) render("通話に参加中です。"); });
      nextRoom.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => { if (room === nextRoom && connected) render("通話に参加中です。"); });
      nextRoom.on(sdk.RoomEvent.Disconnected, (reason) => {
        if (room !== nextRoom) return;
        const reasonName = Object.entries(sdk.DisconnectReason || {}).find(([key, value]) => value === reason && !/^\d+$/.test(key))?.[0] || String(reason ?? "不明");
        disconnectDetail = reasonName === "DUPLICATE_IDENTITY"
          ? "同じ参加者が別のタブで通話に接続しました。別端末かシークレットウィンドウで試してください。"
          : `切断理由：${reasonName}`;
        if (connecting) return;
        disconnect();
        wanted = false;
        render(`通話が切断されました。${disconnectDetail}`);
      });
      await nextRoom.connect(data.serverUrl, data.token);
      if (generation !== currentGeneration) { await nextRoom.disconnect(); return; }
      await nextRoom.localParticipant.setMicrophoneEnabled(!muted);
      if (generation !== currentGeneration) { await nextRoom.disconnect(); return; }
      await nextRoom.startAudio().catch(() => undefined);
      if (generation !== currentGeneration) return;
      if (disconnectDetail) throw new Error(disconnectDetail);
      connecting = false;
      connected = true;
      render("通話に参加中です。");
    } catch (error) {
      if (generation !== currentGeneration) return;
      disconnect();
      wanted = false;
      render(error.name === "NotAllowedError" ? "マイクの使用を許可して、もう一度参加してください。" : `通話に接続できませんでした：${error.message}${disconnectDetail && error.message !== disconnectDetail ? `（${disconnectDetail}）` : ""}`);
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
  play.addEventListener("click", async () => {
    if (!room || !connected) return;
    try {
      await Promise.all([room.startAudio(), ...[...audioContainer.querySelectorAll("audio")].map((element) => element.play())]);
      render("相手の音声を再生しています。");
    } catch { render("音声を再生できません。ブラウザの音声許可と出力先を確認してください。"); }
  });

  return {
    update(nextContext, container) {
      const statusChanged = context?.status !== nextContext?.status;
      const changed = context && nextContext && (context.code !== nextContext.code || context.session !== nextContext.session);
      context = nextContext;
      if (!context || changed) { wanted = false; disconnect(); }
      if (container && panel.parentElement !== container) container.append(panel);
      if (!allowed()) { if (room || connecting) disconnect(); }
      if (statusChanged || changed || !context) render(connected ? "通話に参加中です。" : undefined);
      connect();
    },
    reset() { context = null; wanted = false; disconnect(); panel.hidden = true; onVoiceActive(false); },
  };
}
