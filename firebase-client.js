import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getDatabase, onValue, ref, runTransaction, serverTimestamp, set, update,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

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
  const result = await runTransaction(reference, (current) => (current ? undefined : room));
  return result.committed;
}

export async function joinRoom(roomCode, player) {
  const reference = roomRef(roomCode);
  const result = await runTransaction(reference, (room) => {
    if (!room || room.status !== "waiting" || Object.keys(room.players || {}).length >= 4) return;
    room.players ||= {};
    room.players[player.uid] = player;
    return room;
  });
  return result.committed;
}

export function watchRoom(roomCode, callback) {
  return onValue(roomRef(roomCode), (snapshot) => callback(snapshot.val()));
}

export function startRoom(roomCode, order) {
  return update(roomRef(roomCode), {
    status: "playing",
    phase: "playing",
    order,
    index: 0,
    answer: null,
    usedCards: {},
    startedAt: Date.now() + 1500,
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
    room.index += 1;
    room.phase = "playing";
    room.answer = null;
    room.startedAt = Date.now() + 1500;
    return room;
  });
}

export function answerRoom(roomCode, uid, cardKey, answerKey, points) {
  return runTransaction(roomRef(roomCode), (room) => {
    if (!room || room.status !== "playing" || room.phase !== "playing") return;
    const correct = cardKey === answerKey;
    room.phase = "resolving";
    room.answer = { uid, cardKey, answerKey, correct, points: correct ? points : 0 };
    room.usedCards ||= {};
    room.usedCards[answerKey] = true;
    if (correct && room.players?.[uid]) {
      room.players[uid].score = (room.players[uid].score || 0) + points;
      room.players[uid].correct = (room.players[uid].correct || 0) + 1;
    }
    return room;
  });
}

export function leaveRoom(roomCode, uid) {
  return update(roomRef(roomCode), { [`players/${uid}/connected`]: false });
}

export { serverTimestamp, set };
