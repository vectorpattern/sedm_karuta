import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  get, getDatabase, limitToFirst, onDisconnect, onValue, orderByChild, push, query, ref, runTransaction, serverTimestamp, set, update,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const PLAYER_COLORS = ["#c0392b", "#2166ac", "#198754", "#8e44ad", "#b85c00", "#007f86", "#c21875", "#6654bb", "#657d16", "#80533b"];
function availablePlayerColor(players) {
  const used = new Set(Object.values(players || {}).map((player) => player.color));
  const available = PLAYER_COLORS.filter((color) => !used.has(color));
  return available[Math.floor(Math.random() * available.length)] || PLAYER_COLORS[0];
}
let clockOffset = 0;
onValue(ref(database, ".info/serverTimeOffset"), (snapshot) => { clockOffset = snapshot.val() || 0; });

export function serverNow() {
  return Date.now() + clockOffset;
}

export async function getTrialRankings(category) {
  const snapshot = await get(query(ref(database, `rankings/${category}`), orderByChild("rank"), limitToFirst(5)));
  return Object.values(snapshot.val() || {}).sort((first, second) => second.score - first.score || first.createdAt - second.createdAt);
}

export async function saveTrialRanking(category, name, score) {
  const user = await signInForMatch();
  await set(push(ref(database, `rankings/${category}`)), {
    uid: user.uid, name, score, rank: -score, createdAt: serverTimestamp(),
  });
}

export async function signInForMatch() {
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

export function roomRef(roomCode) {
  return ref(database, `rooms/${roomCode}`);
}

export async function createRoom(roomCode, room) {
  const reference = roomRef(roomCode);
  const result = await runTransaction(reference, (current) => {
    if (current && current.status !== "finished" && Object.values(current.players || {}).some((player) => player.connected !== false)) return;
    const next = structuredClone(room);
    next.players[next.hostUid].color = availablePlayerColor({});
    return next;
  }, { applyLocally: false });
  return result.committed;
}

export async function joinRoom(roomCode, player) {
  const reference = roomRef(roomCode);
  const snapshot = await get(reference);
  if (!snapshot.exists()) throw new Error("ルームが見つかりません。作成者の画面に表示されているコードを確認してください。");
  const { uid, ...playerData } = player;
  let failure = "参加できませんでした。もう一度お試しください。";
  const result = await runTransaction(reference, (room) => {
    if (!room) return null;
    if (room.status !== "waiting") {
      failure = "このルームは開始済み、または終了しています。新しいルームを作ってください。";
      return;
    }
    if (!room.players?.[uid] && Object.keys(room.players || {}).length >= 10) {
      failure = "このルームは満室です（最大10人）。";
      return;
    }
    room.players ||= {};
    room.players[uid] = room.players[uid] ? { ...room.players[uid], connected: true } : { ...playerData, color: availablePlayerColor(room.players) };
    return room;
  });
  if (!result.committed || !result.snapshot.val()?.players?.[uid]) throw new Error(failure);
  return result.committed;
}

export function watchRoom(roomCode, callback) {
  return onValue(roomRef(roomCode), (snapshot) => callback(snapshot.val()));
}

export function startRoom(roomCode, order, boardOrder) {
  return update(roomRef(roomCode), {
    status: "playing",
    phase: "preparing",
    ready: {},
    order,
    boardOrder,
    index: 0,
    answer: null,
    mistakes: {},
    usedCards: {},
    startedAt: 0,
  });
}

export function advanceRoom(roomCode, expectedIndex) {
  return runTransaction(roomRef(roomCode), (room) => {
    if (!room || room.status !== "playing" || room.phase !== "resolving" || room.index !== expectedIndex) return;
    if (room.index + 1 >= room.order.length) {
      room.status = "finished";
      room.phase = "finished";
      return room;
    }
    if (room.answer?.correct === false) room.blockedThrough = {};
    room.index += 1;
    room.phase = "preparing";
    room.ready = {};
    room.answer = null;
    room.mistakes = {};
    room.startedAt = 0;
    return room;
  });
}

export function readyRoom(roomCode, uid, expectedIndex) {
  return runTransaction(roomRef(roomCode), (room) => {
    if (!room || room.status !== "playing" || room.phase !== "preparing" || room.index !== expectedIndex || !room.players?.[uid]) return;
    room.ready ||= {};
    room.ready[uid] = true;
    const players = Object.entries(room.players).filter(([, player]) => player.connected !== false);
    if (players.every(([playerUid]) => room.ready[playerUid])) {
      room.phase = "playing";
      room.startedAt = serverNow() + 3000;
    }
    return room;
  }, { applyLocally: false });
}

export function answerRoom(roomCode, uid, cardKey, answerKey, points, expectedIndex) {
  return runTransaction(roomRef(roomCode), (room) => {
    if (!room || room.status !== "playing" || room.phase !== "playing" || room.index !== expectedIndex || !room.players?.[uid] || room.mistakes?.[uid] || (room.blockedThrough?.[uid] ?? -1) >= room.index) return;
    const correct = cardKey === answerKey;
    if (!correct) {
      room.mistakes ||= {};
      room.mistakes[uid] = true;
      room.blockedThrough ||= {};
      room.blockedThrough[uid] = room.index + 1;
      const players = Object.entries(room.players).filter(([, player]) => player.connected !== false);
      if (!players.every(([playerUid]) => room.mistakes[playerUid] || (room.blockedThrough?.[playerUid] ?? -1) >= room.index)) return room;
    }
    room.phase = "resolving";
    room.answer = { uid, cardKey, answerKey, correct, points: correct ? points : 0 };
    room.usedCards ||= {};
    room.usedCards[answerKey] = true;
    if (correct && room.players?.[uid]) {
      room.players[uid].score = (room.players[uid].score || 0) + points;
      room.players[uid].correct = (room.players[uid].correct || 0) + 1;
    }
    return room;
  }, { applyLocally: false });
}

export function leaveRoom(roomCode, uid) {
  return update(roomRef(roomCode), { [`players/${uid}/connected`]: false });
}

export function watchPresence(roomCode, uid, onError) {
  let stopped = false;
  const connectedRef = ref(database, `rooms/${roomCode}/players/${uid}/connected`);
  const disconnect = onDisconnect(connectedRef);
  const unsubscribe = onValue(ref(database, ".info/connected"), async (snapshot) => {
    if (snapshot.val() !== true) return;
    try {
      await disconnect.set(false);
      if (stopped) { await disconnect.cancel(); return; }
      await set(connectedRef, true);
    } catch (error) {
      onError(error);
    }
  });
  return () => {
    stopped = true;
    unsubscribe();
    disconnect.cancel().catch(onError);
  };
}

export function finishIfPlayerLeft(roomCode) {
  return runTransaction(roomRef(roomCode), (room) => {
    if (!room || room.status !== "playing") return;
    const departed = Object.entries(room.players || {}).find(([, player]) => player.connected === false);
    if (!departed) return;
    room.status = "finished";
    room.phase = "finished";
    room.finishReason = "player-left";
    room.departedName = departed[1].name;
    return room;
  }, { applyLocally: false });
}

export { serverTimestamp, set };
