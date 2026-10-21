import {
  answerRoom, advanceRoom, createRoom, finishIfPlayerLeft, joinRoom, leaveRoom, readyRoom, serverNow, signInForMatch, startRoom, watchPresence, watchRoom,
} from "./firebase-client.js?v=20261021-match2";

const HYAKUNIN_QUESTIONS = 37;
const KARUTA_QUESTIONS = 74;
const ANSWER_SECONDS = 5;
const NEXT_QUESTION_DELAY = 1000;

const setupScreen = document.querySelector("#setup-screen");
const gameScreen = document.querySelector("#game-screen");
const setupSteps = [...document.querySelectorAll(".setup-step")];
const settingSummary = document.querySelector("#setting-summary");
const cardBoard = document.querySelector("#card-board");
const audio = document.querySelector("#reader");
const bgm = new Audio("assets/sfx/bgm.m4a");
const correctSound = new Audio("assets/sfx/correct.mp3");
const wrongSound = new Audio("assets/sfx/wrong.mp3");
const startSound = new Audio("assets/sfx/start.mp3");
bgm.loop = true;
bgm.preload = "auto";
const startButton = document.querySelector("#start-button");
const replayButton = document.querySelector("#replay-button");
const nextButton = document.querySelector("#next-button");
const endButton = document.querySelector("#end-button");
const boardSizeControl = document.querySelector("#board-size-control");
const scoreStatus = document.querySelector("#score-status");
const timerStatus = document.querySelector("#timer-status");
const roundElement = document.querySelector("#round");
const remainingStatus = document.querySelector("#remaining-status");
const takenStatus = document.querySelector("#taken-status");
const remainingElement = document.querySelector("#remaining");
const takenElement = document.querySelector("#taken");
const scoreElement = document.querySelector("#score");
const timerElement = document.querySelector("#timer");
const messageElement = document.querySelector("#message");
const resultDialog = document.querySelector("#result-dialog");
const resultTitle = document.querySelector("#result-title");
const resultLabel = document.querySelector("#result-label");
const finalScoreElement = document.querySelector("#final-score");
const resultMessageElement = document.querySelector("#result-message");
const restartButton = document.querySelector("#restart-button");
const roomDialog = document.querySelector("#room-dialog");
const roomEntry = document.querySelector("#room-entry");
const roomWaiting = document.querySelector("#room-waiting");
const playerNameInput = document.querySelector("#player-name");
const roomCodeInput = document.querySelector("#room-code-input");
const createRoomButton = document.querySelector("#create-room-button");
const joinRoomButton = document.querySelector("#join-room-button");
const roomStartButton = document.querySelector("#room-start-button");
const roomCodeDisplay = document.querySelector("#room-code-display");
const roomPlayerList = document.querySelector("#room-player-list");
const roomMessage = document.querySelector("#room-message");
const roomBackButton = document.querySelector("#room-back-button");

const labels = {
  virtual: "ヴァーチャルカルタモード",
  physical: "現実カルタモード",
  karuta: "初級：カルタモード",
  hyakunin: "上級：百人一首モード",
  source: "音源モード",
  recitation: "詠みあげモード",
  solo: "タイムトライアル",
  online: "オンライン対戦",
};

let selectedSettings = { playMode: "virtual", difficulty: "hyakunin", audioStyle: "recitation", matchType: "solo" };
let activeSettings = null;
let setupStep = 1;
let questionOrder = [];
let questionIndex = 0;
let score = 0;
let correctAnswers = 0;
let currentAnswer = null;
let canAnswer = false;
let timeLeft = ANSWER_SECONDS;
let countdownId = null;
let nextQuestionId = null;
let elapsedTimerId = null;
let questionStartedAt = null;
let boardSize = "small";
let onlineRoomCode = null;
let onlineRoom = null;
let onlineUser = null;
let onlineUnsubscribe = null;
let onlineAdvanceTimer = null;
let onlineAudioTimer = null;
let onlineQuestionIndex = -1;
let waitingForFirstAudio = false;
let gameSession = 0;
let revealTimerId = null;
let onlineResolvedIndex = -1;
let onlinePreparedIndex = -1;
let onlineSetupPending = false;
let presenceUnsubscribe = null;
const onlinePlayers = document.querySelector("#online-players");
const resultRanking = document.querySelector("#result-ranking");

function renderOnlinePlayers() {
  onlinePlayers.replaceChildren();
  Object.entries(onlineRoom?.players || {}).sort(([firstUid], [secondUid]) => Number(secondUid === onlineUser?.uid) - Number(firstUid === onlineUser?.uid)).forEach(([uid, player]) => {
    const item = document.createElement("p");
    const resting = (onlineRoom.blockedThrough?.[uid] ?? -1) >= onlineRoom.index;
    item.textContent = `${player.name}${uid === onlineUser?.uid ? "（自分）" : ""}：${player.correct || 0}枚${resting ? " ／ お手つき・お休み" : ""}`;
    onlinePlayers.append(item);
  });
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function numberText(number, digits) {
  return String(number).padStart(digits, "0");
}

function setMessage(message) {
  messageElement.textContent = message;
}

function updateStatus() {
  roundElement.textContent = `${Math.min(questionIndex + 1, totalQuestions())} / ${totalQuestions()}`;
  scoreElement.textContent = score;
  if (isOnlineMatch()) {
    const usedCards = Object.keys(onlineRoom?.usedCards || {}).length;
    remainingElement.textContent = Math.max(0, totalQuestions() - usedCards);
    takenElement.textContent = correctAnswers;
  }
}

function playSound(sound) {
  sound.pause();
  sound.currentTime = 0;
  return sound.play().catch(() => undefined);
}

function startBackgroundMusic() {
  if (gameScreen.hidden && bgm.paused) bgm.play().catch(() => undefined);
}

function stopBackgroundMusic() {
  bgm.pause();
  bgm.currentTime = 0;
}

function playStartSound() {
  stopBackgroundMusic();
  startSound.pause();
  startSound.currentTime = 0;
  return new Promise((resolve) => {
    const finish = () => resolve();
    startSound.addEventListener("ended", finish, { once: true });
    startSound.addEventListener("error", finish, { once: true });
    startSound.play().catch(finish);
  });
}

function clearTimers() {
  window.clearTimeout(revealTimerId);
  revealTimerId = null;
  window.clearInterval(countdownId);
  window.clearTimeout(nextQuestionId);
  window.clearInterval(elapsedTimerId);
  countdownId = null;
  nextQuestionId = null;
  elapsedTimerId = null;
}

function audioPath(number) {
  const level = activeSettings.difficulty === "karuta" ? "カルタ" : "百人一首";
  if (activeSettings.audioStyle === "source") {
    return `mp3音源_${level}用/SEDMカルタ_${level}用_分割_${numberText(number, 3)}.m4a`.normalize("NFC");
  }
  if (activeSettings.difficulty === "karuta") {
    return `mp3詠みあげ_カルタ用/00 - ${1000 + number}.mp3`.normalize("NFC");
  }
  return `mp3詠みあげ_${level}用/${numberText(number, 4)}.mp3`.normalize("NFC");
}

function isVirtualMode() {
  return activeSettings?.playMode === "virtual";
}

function isOnlineMatch() {
  return activeSettings?.matchType === "online";
}

function totalQuestions() {
  return activeSettings?.difficulty === "karuta" ? KARUTA_QUESTIONS : HYAKUNIN_QUESTIONS;
}

function cardForQuestion(questionNumber) {
  if (activeSettings.difficulty === "karuta") {
    const cardNumber = Math.ceil(questionNumber / 2);
    const cardType = questionNumber % 2 === 1 ? "上" : "下";
    return { key: `${cardType}-${cardNumber}`, cardType, cardNumber };
  }
  return { key: `下-${questionNumber}`, cardType: "下", cardNumber: questionNumber };
}

function setCardsEnabled(enabled) {
  document.querySelectorAll(".card").forEach((card) => {
    if (!card.classList.contains("is-answered")) card.disabled = !enabled;
  });
}

function setBoardSize(size) {
  boardSize = size;
  cardBoard.dataset.size = size;
  document.querySelectorAll("[data-board-size]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.boardSize === size);
  });
}

function elapsedSeconds() {
  return questionStartedAt === null ? 0 : (performance.now() - questionStartedAt) / 1000;
}

function updateElapsedTime() {
  timerElement.textContent = `${elapsedSeconds().toFixed(1)}秒`;
}

function startElapsedTimer() {
  window.clearInterval(elapsedTimerId);
  questionStartedAt = performance.now();
  updateElapsedTime();
  elapsedTimerId = window.setInterval(updateElapsedTime, 100);
}

function stopElapsedTimer() {
  window.clearInterval(elapsedTimerId);
  elapsedTimerId = null;
  updateElapsedTime();
}

function pointsForElapsedTime(seconds) {
  if (seconds <= 1) return 10;
  if (seconds <= 2) return 7;
  if (seconds <= 3) return 5;
  if (seconds <= 5) return 3;
  if (seconds <= 10) return 2;
  return 1;
}

function roomCode() {
  return Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
}

function playerName() {
  return playerNameInput.value.trim().slice(0, 12) || "プレイヤー";
}

function renderCards() {
  cardBoard.replaceChildren();
  const cards = Array.from({ length: totalQuestions() }, (_, index) => cardForQuestion(index + 1));
  const orderedCards = isOnlineMatch() && onlineRoom?.boardOrder
    ? onlineRoom.boardOrder.map((number) => cardForQuestion(number)) : shuffle(cards);
  orderedCards.forEach((cardInfo) => {
    const card = document.createElement("button");
    const image = document.createElement("img");
    card.type = "button";
    card.className = "card";
    card.dataset.cardKey = cardInfo.key;
    card.disabled = true;
    card.setAttribute("aria-label", `カルタ札 ${cardInfo.cardType}${numberText(cardInfo.cardNumber, 2)}`);
    image.src = `カルタ札/${cardInfo.cardType}${numberText(cardInfo.cardNumber, 2)}.png`;
    image.alt = "";
    card.append(image);
    card.addEventListener("click", () => chooseCard(card, cardInfo.key));
    cardBoard.append(card);
  });
}

function startCountdown() {
  timeLeft = ANSWER_SECONDS;
  setMessage(`札を選んでください。読み終わり後の制限時間は残り${timeLeft}秒です。`);
  countdownId = window.setInterval(() => {
    timeLeft -= 1;
    if (timeLeft <= 0) {
      handleTimeout();
      return;
    }
    setMessage(`札を選んでください。読み終わり後の制限時間は残り${timeLeft}秒です。`);
  }, 1000);
}

function playQuestion() {
  clearTimers();
  document.querySelectorAll(".card.is-wrong").forEach((card) => card.classList.remove("is-wrong"));
  currentAnswer = questionOrder[questionIndex];
  updateStatus();
  replayButton.disabled = true;
  nextButton.disabled = true;
  audio.src = audioPath(currentAnswer);
  audio.currentTime = 0;

  if (isVirtualMode()) {
    canAnswer = true;
    setCardsEnabled(true);
    startElapsedTimer();
    setMessage(waitingForFirstAudio ? "Now loading..." : "読み上げの途中から札を選べます。読み終わり後は5秒以内に回答！");
  } else {
    canAnswer = false;
    setMessage(waitingForFirstAudio ? "Now loading..." : "実物の札を取りながら、読み上げを聞いてください。");
  }

  audio.play().catch(() => handleAudioError());
}

function handleAudioError() {
  if (isVirtualMode()) {
    canAnswer = false;
    setCardsEnabled(false);
    stopElapsedTimer();
  }
  setMessage("音声を再生できませんでした。もう一度聞くか、次の句へ進んでください。");
  replayButton.disabled = false;
  if (!isVirtualMode()) nextButton.disabled = false;
}

function moveToNextQuestion() {
  questionIndex += 1;
  if (questionIndex >= totalQuestions()) {
    endGame();
    return;
  }
  playQuestion();
}

function finishVirtualQuestion(message) {
  canAnswer = false;
  audio.pause();
  window.clearInterval(countdownId);
  countdownId = null;
  stopElapsedTimer();
  setCardsEnabled(false);
  replayButton.disabled = true;
  setMessage(`${message}（経過時間 ${timerElement.textContent}）`);
  nextQuestionId = window.setTimeout(moveToNextQuestion, NEXT_QUESTION_DELAY);
}

function revealCorrectCard(message, selectedCard = null) {
  const answerCard = document.querySelector(`[data-card-key="${cardForQuestion(currentAnswer).key}"]`);
  canAnswer = false;
  audio.pause();
  window.clearInterval(countdownId);
  countdownId = null;
  stopElapsedTimer();
  setCardsEnabled(false);
  selectedCard?.classList.add("is-wrong");
  answerCard?.classList.add("is-revealed");
  playSound(wrongSound);
  revealTimerId = window.setTimeout(() => {
    answerCard?.classList.remove("is-revealed");
    answerCard?.classList.add("is-answered");
    finishVirtualQuestion(message);
  }, 900);
}

function markUsedCards(usedCards = {}) {
  document.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("is-answered", Boolean(usedCards[card.dataset.cardKey]));
  });
}

function playOnlineQuestion() {
  clearTimers();
  window.clearTimeout(onlineAudioTimer);
  currentAnswer = questionOrder[questionIndex];
  onlineQuestionIndex = questionIndex;
  updateStatus();
  markUsedCards(onlineRoom?.usedCards);
  setCardsEnabled(false);
  replayButton.disabled = true;
  if (onlineRoom?.phase === "preparing") {
    if (onlinePreparedIndex === questionIndex) return;
    onlinePreparedIndex = questionIndex;
    const preparedIndex = questionIndex;
    const session = gameSession;
    setMessage("Now loading... 全員の音声準備を待っています。");
    const prepared = () => {
      audio.removeEventListener("canplaythrough", prepared);
      if (session === gameSession && onlineRoom?.index === preparedIndex) {
        readyRoom(onlineRoomCode, onlineUser.uid, preparedIndex).catch(() => setMessage("開始準備の通信に失敗しました。"));
      }
    };
    audio.addEventListener("canplaythrough", prepared, { once: true });
    audio.src = audioPath(currentAnswer);
    audio.load();
    return;
  }
  if (onlinePreparedIndex !== questionIndex) audio.src = audioPath(currentAnswer);
  audio.currentTime = 0;
  const wait = Math.max(0, (onlineRoom?.startedAt || serverNow()) - serverNow());
  setMessage(waitingForFirstAudio ? "Now loading..." : wait ? "全員そろって、まもなく読み上げが始まります…" : "読み上げを聞いて札を選んでください。");
  onlineAudioTimer = window.setTimeout(() => {
    canAnswer = !onlineRoom?.mistakes?.[onlineUser?.uid] && (onlineRoom?.blockedThrough?.[onlineUser?.uid] ?? -1) < questionIndex;
    setCardsEnabled(canAnswer);
    startElapsedTimer();
    audio.play().catch(() => handleAudioError());
  }, wait);
}

function submitOnlineAnswer(cardKey) {
  if (!canAnswer || !onlineRoomCode || !onlineUser) return;
  canAnswer = false;
  setCardsEnabled(false);
  const answerKey = cardForQuestion(currentAnswer).key;
  if (cardKey !== answerKey) playSound(wrongSound);
  answerRoom(onlineRoomCode, onlineUser.uid, cardKey, answerKey, 1, questionIndex).catch(() => {
    if (onlineRoom?.phase === "playing" && !onlineRoom?.mistakes?.[onlineUser.uid] && (onlineRoom?.blockedThrough?.[onlineUser.uid] ?? -1) < questionIndex) {
      canAnswer = true;
      setCardsEnabled(true);
      setMessage("回答を送信できませんでした。もう一度札を選んでください。");
    }
  });
}

function chooseCard(card, cardKey) {
  if (!canAnswer) return;
  if (isOnlineMatch()) {
    submitOnlineAnswer(cardKey);
    return;
  }
  if (cardKey === cardForQuestion(currentAnswer).key) {
    const earnedPoints = pointsForElapsedTime(elapsedSeconds());
    score += earnedPoints;
    correctAnswers += 1;
    scoreElement.textContent = score;
    card.classList.add("is-answered");
    playSound(correctSound);
    finishVirtualQuestion(`正解！ ${earnedPoints}ポイント獲得です。`);
  } else {
    revealCorrectCard("残念、不正解です。ポイントは入りません。", card);
  }
}

function handleTimeout() {
  if (!canAnswer) return;
  revealCorrectCard(`時間切れ。正解は札 ${numberText(currentAnswer, 2)} でした。`);
}

function replayQuestion() {
  if (isOnlineMatch()) {
    if (!currentAnswer || onlineRoom?.phase !== "playing") return;
    audio.currentTime = 0;
    replayButton.disabled = true;
    audio.play().catch(() => handleAudioError());
    return;
  }
  if (!currentAnswer || nextQuestionId) return;
  window.clearInterval(countdownId);
  countdownId = null;
  audio.currentTime = 0;
  replayButton.disabled = true;
  nextButton.disabled = true;
  if (isVirtualMode()) startElapsedTimer();
  setMessage("もう一度、読み上げを聞いてください…");
  audio.play().catch(() => handleAudioError());
}

function startGame() {
  if (selectedSettings.matchType === "online") {
    if (selectedSettings.playMode !== "virtual") {
      window.alert("オンライン対戦はヴァーチャルカルタモードで遊べます。");
      return;
    }
    openRoomLobby();
    return;
  }
  setupGame({ ...selectedSettings }, shuffle(Array.from({ length: selectedSettings.difficulty === "karuta" ? KARUTA_QUESTIONS : HYAKUNIN_QUESTIONS }, (_, index) => index + 1)));
}

async function setupGame(settings, order) {
  const session = ++gameSession;
  activeSettings = settings;
  clearTimers();
  audio.pause();
  questionOrder = order;
  questionIndex = 0;
  score = 0;
  correctAnswers = 0;
  onlineResolvedIndex = -1;
  onlinePreparedIndex = -1;
  onlineSetupPending = true;
  currentAnswer = null;
  questionStartedAt = null;
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  waitingForFirstAudio = true;
  setMessage("Now loading...");
  resultDialog.close();
  endButton.disabled = false;
  scoreStatus.hidden = !isVirtualMode() || isOnlineMatch();
  timerStatus.hidden = !isVirtualMode() || isOnlineMatch();
  onlinePlayers.hidden = !isOnlineMatch();
  resultRanking.hidden = true;
  remainingStatus.hidden = !isOnlineMatch();
  takenStatus.hidden = !isOnlineMatch();
  nextButton.hidden = isVirtualMode();
  cardBoard.hidden = !isVirtualMode();
  boardSizeControl.hidden = !isVirtualMode();
  setBoardSize(boardSize);
  if (isVirtualMode()) renderCards(); else cardBoard.replaceChildren();
  updateStatus();
  if (isOnlineMatch()) renderOnlinePlayers();
  await playStartSound();
  if (session !== gameSession || gameScreen.hidden) return;
  onlineSetupPending = false;
  if (isOnlineMatch()) playOnlineQuestion(); else playQuestion();
}

async function openRoomLobby(joinOnly = false) {
  roomMessage.textContent = "Firebaseへ接続しています…";
  roomDialog.showModal();
  roomEntry.hidden = false;
  roomWaiting.hidden = true;
  createRoomButton.hidden = joinOnly;
  document.querySelector("#player-name-label").hidden = joinOnly;
  document.querySelector("#room-code-label").hidden = !joinOnly;
  joinRoomButton.hidden = !joinOnly;
  try {
    onlineUser = await signInForMatch();
    roomMessage.textContent = joinOnly ? "相手から受け取ったルームコードを入力してください。" : "表示名を入力してルームを作ってください。相手のルームに参加する場合は、スタート画面へ戻ってください。";
  } catch (error) {
    roomMessage.textContent = `接続できませんでした：${error.message}`;
  }
}

function beginWatchingRoom(code) {
  onlineUnsubscribe?.();
  presenceUnsubscribe?.();
  presenceUnsubscribe = watchPresence(code, onlineUser.uid, (error) => { roomMessage.textContent = `接続状態を登録できませんでした：${error.message}`; });
  onlineRoomCode = code;
  onlineUnsubscribe = watchRoom(code, (room) => syncOnlineRoom(room));
}

function renderRoomWaiting(room) {
  roomEntry.hidden = true;
  roomWaiting.hidden = false;
  roomCodeDisplay.textContent = onlineRoomCode;
  const players = Object.values(room.players || {});
  roomPlayerList.textContent = `参加者（${players.length}/4）：${players.map((player) => player.name).join("、")}`;
  roomStartButton.hidden = room.hostUid !== onlineUser?.uid;
  roomStartButton.disabled = players.length < 2;
  roomMessage.textContent = players.length < 2 ? "対戦相手の参加を待っています。" : "2人以上そろいました。ホストが開始できます。";
}

function syncOnlineRoom(room) {
  if (!room) {
    roomMessage.textContent = "ルームが見つかりません。";
    return;
  }
  onlineRoom = room;
  if (room.status === "playing" && Object.values(room.players || {}).some((player) => player.connected === false)) {
    audio.pause();
    canAnswer = false;
    setCardsEnabled(false);
    finishIfPlayerLeft(onlineRoomCode).catch(() => setMessage("退出による終了処理に失敗しました。"));
    return;
  }
  if (room.status === "waiting") {
    renderRoomWaiting(room);
    return;
  }
  if (room.status === "playing") {
    roomDialog.close();
    if (gameScreen.hidden) {
      onlineQuestionIndex = -1;
      setupGame(room.settings, room.order);
      return;
    }
    if (onlineSetupPending) return;
    score = room.players?.[onlineUser?.uid]?.score || 0;
    correctAnswers = room.players?.[onlineUser?.uid]?.correct || 0;
    scoreElement.textContent = score;
    markUsedCards(room.usedCards);
    updateStatus();
    renderOnlinePlayers();
    if (room.phase === "preparing" && onlinePreparedIndex !== room.index) {
      questionIndex = room.index;
      playOnlineQuestion();
    }
    if (room.phase === "playing" && (onlineQuestionIndex !== room.index || onlinePreparedIndex === room.index)) {
      questionIndex = room.index;
      playOnlineQuestion();
      onlinePreparedIndex = -1;
    }
    if (room.phase === "playing" && (room.mistakes?.[onlineUser?.uid] || (room.blockedThrough?.[onlineUser?.uid] ?? -1) >= room.index)) {
      if (canAnswer) playSound(wrongSound);
      canAnswer = false;
      setCardsEnabled(false);
      setMessage(room.mistakes?.[onlineUser?.uid]
        ? "お手つき！ この問題と次の問題は回答できません。相手の回答を待ってください。"
        : "前の問題のお手つきで、この問題はお休みです。次の問題から参加できます。");
    }
    if (room.phase === "resolving") {
      canAnswer = false;
      audio.pause();
      stopElapsedTimer();
      setCardsEnabled(false);
      const answer = room.answer;
      const result = answer.correct
        ? `${room.players?.[answer.uid]?.name || "プレイヤー"}が正解！ 1枚獲得です。`
        : "全員がお手つきになりました。次の問題へ進みます。";
      setMessage(result);
      if (onlineResolvedIndex !== room.index) {
        onlineResolvedIndex = room.index;
        if (answer.correct) playSound(answer.uid === onlineUser?.uid ? correctSound : wrongSound);
        window.clearTimeout(onlineAdvanceTimer);
        onlineAdvanceTimer = window.setTimeout(() => advanceRoom(onlineRoomCode, room.index).catch(() => setMessage("次の問題への通信に失敗しました。")), NEXT_QUESTION_DELAY);
      }
    }
    return;
  }
  if (room.status === "finished") {
    correctAnswers = room.players?.[onlineUser?.uid]?.correct || 0;
    endGame();
  }
}

async function createOnlineRoom() {
  if (!onlineUser) onlineUser = await signInForMatch();
  createRoomButton.disabled = true;
  const code = roomCode();
  const settings = { ...selectedSettings, matchType: "online" };
  const room = {
    hostUid: onlineUser.uid,
    status: "waiting",
    settings,
    players: { [onlineUser.uid]: { name: playerName(), score: 0, correct: 0, connected: true } },
    createdAt: Date.now(),
  };
  const created = await createRoom(code, room);
  createRoomButton.disabled = false;
  if (!created) return createOnlineRoom();
  beginWatchingRoom(code);
}

async function joinOnlineRoom() {
  if (!onlineUser) onlineUser = await signInForMatch();
  const code = roomCodeInput.value.normalize("NFKC").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    roomMessage.textContent = "6文字のルームコードを入力してください。";
    return;
  }
  joinRoomButton.disabled = true;
  await joinRoom(code, { uid: onlineUser.uid, name: playerName(), score: 0, correct: 0, connected: true });
  joinRoomButton.disabled = false;
  beginWatchingRoom(code);
}

function startOnlineRoom() {
  if (onlineRoom?.hostUid !== onlineUser?.uid) return;
  const order = shuffle(Array.from({ length: onlineRoom.settings.difficulty === "karuta" ? KARUTA_QUESTIONS : HYAKUNIN_QUESTIONS }, (_, index) => index + 1));
  return startRoom(onlineRoomCode, order, shuffle([...order]));
}

async function runRoomAction(action) {
  try {
    await action();
  } catch (error) {
    const detail = `${error.code || ""} ${error.message || ""}`;
    roomMessage.textContent = /permission.denied/i.test(detail)
      ? "ルームへの接続が許可されていません。FirebaseのRealtime Databaseのルール設定を確認してください。"
      : `操作に失敗しました。再試行してください：${detail}`;
  } finally {
    createRoomButton.disabled = false;
    joinRoomButton.disabled = false;
  }
}

function showSetup() {
  presenceUnsubscribe?.();
  presenceUnsubscribe = null;
  gameSession += 1;
  waitingForFirstAudio = false;
  startSound.pause();
  clearTimers();
  window.clearTimeout(onlineAudioTimer);
  window.clearTimeout(onlineAdvanceTimer);
  audio.pause();
  onlineUnsubscribe?.();
  onlineUnsubscribe = null;
  onlineRoom = null;
  onlineRoomCode = null;
  activeSettings = null;
  canAnswer = false;
  questionStartedAt = null;
  resultDialog.close();
  gameScreen.hidden = true;
  setupScreen.hidden = false;
  startBackgroundMusic();
  setupStep = 1;
  updateSetupScreen();
}

function endGame(endedEarly = false) {
  presenceUnsubscribe?.();
  presenceUnsubscribe = null;
  gameSession += 1;
  waitingForFirstAudio = false;
  startSound.pause();
  clearTimers();
  window.clearTimeout(onlineAudioTimer);
  window.clearTimeout(onlineAdvanceTimer);
  onlineUnsubscribe?.();
  onlineUnsubscribe = null;
  audio.pause();
  canAnswer = false;
  endButton.disabled = true;
  replayButton.disabled = true;
  nextButton.disabled = true;
  if (isOnlineMatch()) {
    resultTitle.textContent = endedEarly ? "対戦を退出しました" : "結果発表";
    resultLabel.textContent = "自分の取得札";
    finalScoreElement.textContent = `${correctAnswers} 枚`;
    resultMessageElement.textContent = onlineRoom?.finishReason === "player-left"
      ? `${onlineRoom.departedName || "参加者"}が退出したため対戦を終了しました。終了時点の順位です。`
      : endedEarly ? "退出時点の順位です。" : "取得枚数による順位です。";
    resultRanking.replaceChildren();
    const players = Object.entries(onlineRoom?.players || {}).sort(([, first], [, second]) => (second.correct || 0) - (first.correct || 0));
    let rank = 0;
    let previousCount = null;
    players.forEach(([uid, player], index) => {
      const count = player.correct || 0;
      if (count !== previousCount) rank = index + 1;
      previousCount = count;
      const item = document.createElement("li");
      item.textContent = `${rank}位　${player.name}${uid === onlineUser?.uid ? "（自分）" : ""}　${count}枚`;
      resultRanking.append(item);
    });
    resultRanking.hidden = false;
  } else if (isVirtualMode()) {
    timerElement.textContent = questionStartedAt === null ? "--" : `${elapsedSeconds().toFixed(1)}秒`;
    resultTitle.textContent = endedEarly ? "ゲームを終了しました" : "ゲーム終了！";
    resultLabel.textContent = "合計ポイント";
    finalScoreElement.textContent = `${score} 点`;
    resultMessageElement.textContent = endedEarly
      ? `${questionIndex + 1}問目で終了しました。${correctAnswers}問正解です。`
      : `${totalQuestions()}問中 ${correctAnswers}問正解でした。`;
  } else {
    resultTitle.textContent = endedEarly ? "読み上げを終了しました" : "全句の読み上げが終了しました";
    resultLabel.textContent = "読み上げた句";
    finalScoreElement.textContent = `${Math.min(questionIndex + 1, totalQuestions())} 句`;
    resultMessageElement.textContent = endedEarly ? "おつかれさまでした。" : "全ての句を読み上げました。";
  }
  resultDialog.showModal();
}

function updateSetupScreen() {
  document.querySelectorAll(".choice-button").forEach((button) => {
    button.classList.toggle("is-selected", selectedSettings[button.dataset.setting] === button.dataset.value);
  });
  setupSteps.forEach((step) => { step.hidden = Number(step.dataset.step) !== setupStep; });
  document.querySelector('[data-step="5"] h2').textContent = selectedSettings.playMode === "physical" ? "4. 設定を確認" : "5. 設定を確認";
  settingSummary.innerHTML = [
    ["プレイモード", labels[selectedSettings.playMode]],
    ["難易度", labels[selectedSettings.difficulty]],
    ["音声", labels[selectedSettings.audioStyle]],
    ...(selectedSettings.playMode === "physical" ? [] : [["対戦形式", labels[selectedSettings.matchType]]]),
  ].map(([term, description]) => `<dt>${term}</dt><dd>${description}</dd>`).join("");
}

document.querySelectorAll(".choice-button").forEach((button) => {
  button.addEventListener("click", () => {
    startBackgroundMusic();
    selectedSettings[button.dataset.setting] = button.dataset.value;
    if (selectedSettings.playMode === "physical") selectedSettings.matchType = "solo";
    document.querySelectorAll(`[data-setting="${button.dataset.setting}"]`).forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });
  });
});

document.querySelectorAll(".step-next").forEach((button) => {
  button.addEventListener("click", () => {
    startBackgroundMusic();
    setupStep = selectedSettings.playMode === "physical" && setupStep === 3 ? 5 : Math.min(setupStep + 1, 5);
    updateSetupScreen();
  });
});

document.querySelectorAll(".step-back").forEach((button) => {
  button.addEventListener("click", () => {
    startBackgroundMusic();
    setupStep = selectedSettings.playMode === "physical" && setupStep === 5 ? 3 : Math.max(setupStep - 1, 1);
    updateSetupScreen();
  });
});

document.querySelectorAll("[data-board-size]").forEach((button) => {
  button.addEventListener("click", () => setBoardSize(button.dataset.boardSize));
});

audio.addEventListener("playing", () => {
  if (!waitingForFirstAudio) return;
  waitingForFirstAudio = false;
  setMessage(isOnlineMatch()
    ? "読み上げを聞いて札を選んでください。"
    : isVirtualMode()
      ? "読み上げの途中から札を選べます。読み終わり後は5秒以内に回答！"
      : "実物の札を取りながら、読み上げを聞いてください。");
});

audio.addEventListener("ended", () => {
  replayButton.disabled = false;
  if (isOnlineMatch()) {
    return;
  }
  if (isVirtualMode()) {
    if (canAnswer && !nextQuestionId) startCountdown();
  } else {
    nextButton.disabled = false;
    setMessage("読み上げが終わりました。次の句へ進む準備ができました。");
  }
});

audio.addEventListener("error", () => {
  if (!nextQuestionId) handleAudioError();
});

startButton.addEventListener("click", startGame);
document.querySelector("#home-join-button").addEventListener("click", () => openRoomLobby(true));
replayButton.addEventListener("click", replayQuestion);
nextButton.addEventListener("click", moveToNextQuestion);
endButton.addEventListener("click", async () => {
  if (!isOnlineMatch()) return endGame(true);
  endButton.disabled = true;
  presenceUnsubscribe?.();
  presenceUnsubscribe = null;
  try {
    await leaveRoom(onlineRoomCode, onlineUser.uid);
    await finishIfPlayerLeft(onlineRoomCode);
  } catch {
    endButton.disabled = false;
    setMessage("退出を送信できませんでした。もう一度お試しください。");
  }
});
restartButton.addEventListener("click", showSetup);
createRoomButton.addEventListener("click", () => runRoomAction(createOnlineRoom));
joinRoomButton.addEventListener("click", () => runRoomAction(joinOnlineRoom));
roomStartButton.addEventListener("click", () => runRoomAction(startOnlineRoom));
roomBackButton.addEventListener("click", async () => {
  if (onlineRoomCode && onlineUser) {
    presenceUnsubscribe?.();
    presenceUnsubscribe = null;
    onlineUnsubscribe?.();
    onlineUnsubscribe = null;
    await leaveRoom(onlineRoomCode, onlineUser.uid).catch(() => undefined);
    onlineRoomCode = null;
    onlineRoom = null;
  }
  roomDialog.close();
});
roomDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  roomBackButton.click();
});

updateSetupScreen();

