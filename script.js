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
const startButton = document.querySelector("#start-button");
const replayButton = document.querySelector("#replay-button");
const nextButton = document.querySelector("#next-button");
const endButton = document.querySelector("#end-button");
const settingsButton = document.querySelector("#settings-button");
const boardSizeControl = document.querySelector("#board-size-control");
const scoreStatus = document.querySelector("#score-status");
const timerStatus = document.querySelector("#timer-status");
const roundElement = document.querySelector("#round");
const scoreElement = document.querySelector("#score");
const timerElement = document.querySelector("#timer");
const messageElement = document.querySelector("#message");
const resultDialog = document.querySelector("#result-dialog");
const resultTitle = document.querySelector("#result-title");
const resultLabel = document.querySelector("#result-label");
const finalScoreElement = document.querySelector("#final-score");
const resultMessageElement = document.querySelector("#result-message");
const restartButton = document.querySelector("#restart-button");

const labels = {
  virtual: "ヴァーチャルカルタモード",
  physical: "現実カルタモード",
  karuta: "初級：カルタモード",
  hyakunin: "上級：百人一首モード",
  source: "音源モード",
  recitation: "詠みあげモード",
};

let selectedSettings = { playMode: "virtual", difficulty: "hyakunin", audioStyle: "recitation" };
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
let boardSize = "medium";

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
}

function clearTimers() {
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
    return `mp3音源_${level}用/SEDMカルタ_${level}用_分割_${numberText(number, 3)}.m4a`;
  }
  if (activeSettings.difficulty === "karuta") {
    return `mp3詠みあげ_カルタ用/00 - ${1000 + number}.mp3`;
  }
  return `mp3詠みあげ_${level}用/${numberText(number, 4)}.mp3`;
}

function isVirtualMode() {
  return activeSettings?.playMode === "virtual";
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

function renderCards() {
  cardBoard.replaceChildren();
  const cards = Array.from({ length: totalQuestions() }, (_, index) => cardForQuestion(index + 1));
  shuffle(cards).forEach((cardInfo) => {
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
    setMessage("読み上げの途中から札を選べます。読み終わり後は5秒以内に回答！");
  } else {
    canAnswer = false;
    setMessage("実物の札を取りながら、読み上げを聞いてください。");
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

function chooseCard(card, cardKey) {
  if (!canAnswer) return;
  if (cardKey === cardForQuestion(currentAnswer).key) {
    const earnedPoints = pointsForElapsedTime(elapsedSeconds());
    score += earnedPoints;
    correctAnswers += 1;
    scoreElement.textContent = score;
    card.classList.add("is-answered");
    finishVirtualQuestion(`正解！ ${earnedPoints}ポイント獲得です。`);
  } else {
    document.querySelector(`[data-card-key="${cardForQuestion(currentAnswer).key}"]`)?.classList.add("is-answered");
    finishVirtualQuestion("残念、不正解です。ポイントは入りません。");
  }
}

function handleTimeout() {
  if (!canAnswer) return;
  document.querySelector(`[data-card-key="${cardForQuestion(currentAnswer).key}"]`)?.classList.add("is-answered");
  finishVirtualQuestion(`時間切れ。正解は札 ${numberText(currentAnswer, 2)} でした。`);
}

function replayQuestion() {
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
  activeSettings = { ...selectedSettings };
  clearTimers();
  audio.pause();
  questionOrder = shuffle(Array.from({ length: totalQuestions() }, (_, index) => index + 1));
  questionIndex = 0;
  score = 0;
  correctAnswers = 0;
  currentAnswer = null;
  questionStartedAt = null;
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  resultDialog.close();
  endButton.disabled = false;
  scoreStatus.hidden = !isVirtualMode();
  timerStatus.hidden = !isVirtualMode();
  nextButton.hidden = isVirtualMode();
  cardBoard.hidden = !isVirtualMode();
  boardSizeControl.hidden = !isVirtualMode();
  setBoardSize(boardSize);
  if (isVirtualMode()) renderCards(); else cardBoard.replaceChildren();
  updateStatus();
  playQuestion();
}

function showSetup() {
  clearTimers();
  audio.pause();
  activeSettings = null;
  canAnswer = false;
  questionStartedAt = null;
  resultDialog.close();
  gameScreen.hidden = true;
  setupScreen.hidden = false;
  setupStep = 1;
  updateSetupScreen();
}

function endGame(endedEarly = false) {
  clearTimers();
  audio.pause();
  canAnswer = false;
  endButton.disabled = true;
  replayButton.disabled = true;
  nextButton.disabled = true;
  if (isVirtualMode()) {
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
  setupSteps.forEach((step) => { step.hidden = Number(step.dataset.step) !== setupStep; });
  settingSummary.innerHTML = [
    ["プレイモード", labels[selectedSettings.playMode]],
    ["難易度", labels[selectedSettings.difficulty]],
    ["音声", labels[selectedSettings.audioStyle]],
  ].map(([term, description]) => `<dt>${term}</dt><dd>${description}</dd>`).join("");
}

document.querySelectorAll(".choice-button").forEach((button) => {
  button.addEventListener("click", () => {
    selectedSettings[button.dataset.setting] = button.dataset.value;
    document.querySelectorAll(`[data-setting="${button.dataset.setting}"]`).forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });
  });
});

document.querySelectorAll(".step-next").forEach((button) => {
  button.addEventListener("click", () => {
    setupStep = Math.min(setupStep + 1, 4);
    updateSetupScreen();
  });
});

document.querySelectorAll(".step-back").forEach((button) => {
  button.addEventListener("click", () => {
    setupStep = Math.max(setupStep - 1, 1);
    updateSetupScreen();
  });
});

document.querySelectorAll("[data-board-size]").forEach((button) => {
  button.addEventListener("click", () => setBoardSize(button.dataset.boardSize));
});

audio.addEventListener("ended", () => {
  replayButton.disabled = false;
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
replayButton.addEventListener("click", replayQuestion);
nextButton.addEventListener("click", moveToNextQuestion);
endButton.addEventListener("click", () => endGame(true));
settingsButton.addEventListener("click", showSetup);
restartButton.addEventListener("click", showSetup);

updateSetupScreen();
