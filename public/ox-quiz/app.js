import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { firebaseConfig as fileFirebaseConfig } from "./firebase-config.js";
import {
  getAuth,
  signInAnonymously,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const ADMIN_PASSWORD = "kid";
const STORAGE_KEYS = {
  nickname: "oxQuizNickname",
  admin: "oxQuizAdmin",
};

const $ = (selector) => document.querySelector(selector);
const state = {
  db: null,
  unsubscribers: [],
  connected: false,
  subscriptionsReady: 0,
  authMode: "none",
  admin: sessionStorage.getItem(STORAGE_KEYS.admin) === "true",
  mode: "player",
  currentQuestion: null,
  lastResult: null,
  participants: {},
  history: {},
  blocked: {},
  chat: {},
  chatOpen: false,
  selectedImage: "",
  ticking: null,
  autoClosingId: "",
};

const els = {
  connectionStatus: $("#connectionStatus"),
  playerView: $("#playerView"),
  adminLogin: $("#adminLogin"),
  adminView: $("#adminView"),
  adminLoginForm: $("#adminLoginForm"),
  adminPassword: $("#adminPassword"),
  loginMessage: $("#loginMessage"),
  liveQuestion: $("#liveQuestion"),
  timerBadge: $("#timerBadge"),
  liveImage: $("#liveImage"),
  answerLocked: $("#answerLocked"),
  answerForm: $("#answerForm"),
  oButton: $("#oButton"),
  xButton: $("#xButton"),
  nickname: $("#nickname"),
  questionForm: $("#questionForm"),
  questionText: $("#questionText"),
  correctAnswer: $("#correctAnswer"),
  timeLimit: $("#timeLimit"),
  maxWinners: $("#maxWinners"),
  questionImage: $("#questionImage"),
  imagePreviewWrap: $("#imagePreviewWrap"),
  imagePreview: $("#imagePreview"),
  removeImage: $("#removeImage"),
  closeQuestion: $("#closeQuestion"),
  activeState: $("#activeState"),
  adminTimer: $("#adminTimer"),
  participantList: $("#participantList"),
  participantCount: $("#participantCount"),
  adminHistory: $("#adminHistory"),
  playerHistory: $("#playerHistory"),
  historyCount: $("#historyCount"),
  exportHistory: $("#exportHistory"),
  deleteHistory: $("#deleteHistory"),
  chatPanel: $("#chatPanel"),
  chatToggle: $("#chatToggle"),
  closeChat: $("#closeChat"),
  chatMessages: $("#chatMessages"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  clearChat: $("#clearChat"),
};

function init() {
  const savedNickname = localStorage.getItem(STORAGE_KEYS.nickname);
  loadFirebaseJsonConfig().then((jsonConfig) => {
    if (jsonConfig) {
      const configText = JSON.stringify(jsonConfig, null, 2);
      connectFirebase(configText, "json");
    } else if (hasFileConfig()) {
      const configText = JSON.stringify(fileFirebaseConfig, null, 2);
      connectFirebase(configText, "file");
    } else {
      els.connectionStatus.textContent = "firebase.json 설정을 찾을 수 없습니다.";
    }
  });
  if (savedNickname) els.nickname.value = savedNickname;
  wireEvents();
  renderMode();
  renderAll();
}

function wireEvents() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      renderMode();
    });
  });

  els.adminLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (els.adminPassword.value === ADMIN_PASSWORD) {
      state.admin = true;
      sessionStorage.setItem(STORAGE_KEYS.admin, "true");
      els.loginMessage.textContent = "";
      renderMode();
      return;
    }
    els.loginMessage.textContent = "비밀번호가 맞지 않습니다.";
  });

  els.answerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitter = event.submitter;
    submitAnswer(submitter?.dataset.answer);
  });
  els.nickname.addEventListener("input", renderQuestion);

  els.questionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    publishQuestion();
  });

  els.questionImage.addEventListener("change", handleImageSelect);
  els.removeImage.addEventListener("click", clearImage);
  els.closeQuestion.addEventListener("click", closeCurrentQuestion);
  els.exportHistory.addEventListener("click", exportHistoryCsv);
  els.deleteHistory.addEventListener("click", deleteAllHistory);
  els.chatForm.addEventListener("submit", sendChatMessage);
  els.clearChat.addEventListener("click", clearChatMessages);
  els.chatToggle.addEventListener("click", () => setChatOpen(!state.chatOpen));
  els.closeChat.addEventListener("click", () => setChatOpen(false));
}

function hasFileConfig() {
  return Boolean(fileFirebaseConfig && fileFirebaseConfig.apiKey && fileFirebaseConfig.projectId);
}

async function loadFirebaseJsonConfig() {
  try {
    const response = await fetch("./firebase.json", { cache: "no-store" });
    if (!response.ok) return null;
    const config = await response.json();
    return config?.apiKey && config?.projectId ? config : null;
  } catch {
    return null;
  }
}

async function connectFirebase(rawConfig, source = "manual") {
  try {
    const config = JSON.parse(rawConfig);
    const app = getApps().length ? getApp() : initializeApp(config);
    await signInIfAvailable(app);
    state.db = getFirestore(app);
    state.connected = true;
    els.connectionStatus.textContent =
      source === "json"
        ? connectionMessage("firebase.json 파일 설정으로 연결되었습니다.")
        : source === "file"
          ? connectionMessage("firebase-config.js 파일 설정으로 연결되었습니다.")
          : connectionMessage("Firebase에 연결되었습니다.");
    subscribe();
  } catch (error) {
    state.connected = false;
    els.connectionStatus.textContent = `연결 실패: ${error.message}`;
  }
  renderAll();
}

async function signInIfAvailable(app) {
  try {
    await signInAnonymously(getAuth(app));
    state.authMode = "anonymous";
  } catch (error) {
    if (error.code !== "auth/configuration-not-found") throw error;
    state.authMode = "none";
  }
}

function connectionMessage(message) {
  if (state.authMode === "anonymous") return message;
  return `${message} 익명 로그인이 꺼져 있어 데이터베이스 규칙을 테스트 모드로 설정해야 합니다.`;
}

function subscribe() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.subscriptionsReady = 0;
  state.unsubscribers = [
    onSnapshot(doc(state.db, "oxQuiz", "current"), (snapshot) => {
      state.currentQuestion = snapshot.exists() ? snapshot.data() : null;
      markSubscriptionReady();
      renderAll();
    }, handleSnapshotError),
    onSnapshot(doc(state.db, "oxQuiz", "lastResult"), (snapshot) => {
      state.lastResult = snapshot.exists() ? snapshot.data() : null;
      markSubscriptionReady();
      renderAll();
    }, handleSnapshotError),
    onSnapshot(query(collection(state.db, "oxQuiz", "participants", "items"), orderBy("updatedAt", "desc")), (snapshot) => {
      state.participants = docsToObject(snapshot);
      markSubscriptionReady();
      renderAll();
    }, handleSnapshotError),
    onSnapshot(query(collection(state.db, "oxQuiz", "history", "items"), orderBy("createdAt", "desc")), (snapshot) => {
      state.history = docsToObject(snapshot);
      markSubscriptionReady();
      renderAll();
    }, handleSnapshotError),
    onSnapshot(collection(state.db, "oxQuiz", "blocked", "items"), (snapshot) => {
      state.blocked = docsToObject(snapshot);
      markSubscriptionReady();
      renderAll();
    }, handleSnapshotError),
    onSnapshot(query(collection(state.db, "oxQuiz", "chat", "items"), orderBy("createdAt", "asc")), (snapshot) => {
      state.chat = docsToObject(snapshot);
      markSubscriptionReady();
      renderChat();
    }, handleSnapshotError),
  ];
}

function markSubscriptionReady() {
  state.subscriptionsReady += 1;
  if (state.subscriptionsReady >= 6) {
    els.connectionStatus.textContent = connectionMessage("실시간 연결이 활성화되었습니다.");
  }
}

function handleSnapshotError(error) {
  state.connected = false;
  els.connectionStatus.textContent = `실시간 구독 실패: ${error.code || ""} ${error.message}`;
  renderControls();
}

function renderMode() {
  document.querySelectorAll(".mode-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  els.playerView.classList.toggle("hidden", state.mode !== "player");
  els.adminLogin.classList.toggle("hidden", state.mode !== "admin" || state.admin);
  els.adminView.classList.toggle("hidden", state.mode !== "admin" || !state.admin);
  els.clearChat.classList.toggle("hidden", !(state.mode === "admin" && state.admin));
  renderChatShell();
}

function setChatOpen(open) {
  state.chatOpen = open;
  renderChatShell();
}

function renderChatShell() {
  document.body.classList.toggle("chat-open", state.chatOpen);
  els.chatToggle.setAttribute("aria-expanded", String(state.chatOpen));
}

function renderAll() {
  renderQuestion();
  renderParticipants();
  renderHistory();
  renderChat();
  renderAnswerCounts();
  renderControls();
}

function renderQuestion() {
  const question = state.currentQuestion;
  const active = isQuestionActive(question);
  const result = !question ? state.lastResult : null;
  els.liveQuestion.textContent = question?.text || result?.text || "출제된 문제가 없습니다.";
  els.activeState.textContent = active ? "진행 중" : "대기";
  const imageData = question?.imageData || result?.imageData;
  els.liveImage.classList.toggle("hidden", !imageData);
  if (imageData) els.liveImage.src = imageData;

  clearInterval(state.ticking);
  updateTimer();
  state.ticking = setInterval(updateTimer, 250);

  const nickname = normalizeNickname(els.nickname.value);
  const blocked = nickname && state.blocked[nicknameKey(nickname)];
  els.answerLocked.classList.toggle("hidden", active && !blocked);
  if (result) {
    els.answerLocked.textContent = resultMessage(result);
  } else if (!active) {
    els.answerLocked.textContent = question ? "제한시간이 끝났습니다." : "문제가 출제되면 답안을 선택할 수 있습니다.";
  } else if (blocked) {
    els.answerLocked.textContent = "관리자에 의해 참여가 제한된 닉네임입니다.";
  }
}

function updateTimer() {
  const question = state.currentQuestion;
  if (!question) {
    els.timerBadge.textContent = "대기";
    els.adminTimer.textContent = "대기";
    return;
  }
  const remaining = Math.max(0, question.endsAt - Date.now());
  const timerText = remaining > 0 ? `${Math.ceil(remaining / 1000)}초` : "마감";
  els.timerBadge.textContent = timerText;
  els.adminTimer.textContent = timerText;
  if (remaining <= 0 && state.admin) {
    els.activeState.textContent = "자동 마감 중";
    autoCloseQuestion(question);
  }
}

function autoCloseQuestion(question) {
  if (!state.connected || !question?.id || state.autoClosingId === question.id) return;
  state.autoClosingId = question.id;
  closeCurrentQuestion();
}

function renderControls() {
  const ready = state.connected;
  document.querySelectorAll("#questionForm button, #exportHistory, #deleteHistory, #clearChat").forEach((button) => {
    button.disabled = !ready;
  });
  els.chatInput.disabled = !ready;
  els.chatForm.querySelector("button").disabled = !ready;
  document.querySelectorAll("#answerForm button").forEach((button) => {
    button.disabled = !ready || !isQuestionActive(state.currentQuestion);
  });
  els.closeQuestion.disabled = !ready || !state.currentQuestion;
}

function renderChat() {
  const messages = Object.values(state.chat).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (!messages.length) {
    els.chatMessages.className = "chat-messages empty-state";
    els.chatMessages.textContent = "채팅이 아직 없습니다.";
    return;
  }
  els.chatMessages.className = "chat-messages";
  els.chatMessages.innerHTML = messages.map((message) => `
    <article class="chat-message ${message.role === "admin" ? "admin-chat" : ""}">
      <div>
        <strong>${escapeHtml(message.sender || "익명")}</strong>
        <span>${formatTime(message.createdAt)}</span>
      </div>
      <p>${escapeHtml(message.text || "")}</p>
    </article>
  `).join("");
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function renderParticipants() {
  const entries = Object.values(state.participants).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  els.participantCount.textContent = `${entries.length}명`;
  if (!entries.length) {
    els.participantList.className = "participant-list empty-state";
    els.participantList.textContent = "참여자가 없습니다.";
    return;
  }

  els.participantList.className = "participant-list";
  els.participantList.innerHTML = "";
  entries.forEach((participant) => {
    const node = $("#participantTemplate").content.cloneNode(true);
    node.querySelector("strong").textContent = participant.nickname;
    node.querySelector("span").textContent = `${participant.answer || "-"} 선택 · ${formatTime(participant.updatedAt)}`;
    node.querySelector("button").addEventListener("click", () => blockParticipant(participant));
    els.participantList.appendChild(node);
  });
}

function renderAnswerCounts() {
  const entries = Object.values(state.participants).filter((item) => item.questionId === state.currentQuestion?.id);
  const oCount = entries.filter((item) => item.answer === "O").length;
  const xCount = entries.filter((item) => item.answer === "X").length;
  els.oButton.dataset.count = `${oCount}명 선택`;
  els.xButton.dataset.count = `${xCount}명 선택`;
}

function renderHistory() {
  const entries = Object.entries(state.history)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  els.historyCount.textContent = `${entries.length}개`;
  [els.adminHistory, els.playerHistory].forEach((target) => {
    if (!entries.length) {
      target.className = "history-list empty-state";
      target.textContent = "기록이 아직 없습니다.";
      return;
    }
    target.className = "history-list";
    target.innerHTML = entries.map(historyItemHtml).join("");
  });
}

function historyItemHtml(item) {
  const winners = item.winners || [];
  const winnerHtml = winners.length
    ? `<div class="winner-list">${winners.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
    : `<div class="history-meta">당첨자 없음</div>`;
  return `
    <article class="history-item">
      <strong>${escapeHtml(item.text || "")}</strong>
      <div class="history-meta">정답 ${item.correctAnswer} · 응답 ${item.totalAnswers || 0}명 · ${formatTime(item.createdAt)}</div>
      ${winnerHtml}
    </article>
  `;
}

async function submitAnswer(answer) {
  if (!state.connected || !state.currentQuestion || !answer) return;
  const nickname = normalizeNickname(els.nickname.value);
  if (!nickname) {
    els.answerLocked.classList.remove("hidden");
    els.answerLocked.textContent = "답안을 선택하려면 닉네임을 먼저 입력하세요.";
    els.nickname.focus();
    return;
  }
  if (!isQuestionActive(state.currentQuestion)) {
    els.answerLocked.classList.remove("hidden");
    els.answerLocked.textContent = "현재 답안을 받을 수 없습니다.";
    return;
  }
  if (state.blocked[nicknameKey(nickname)]) {
    els.answerLocked.classList.remove("hidden");
    els.answerLocked.textContent = "관리자에 의해 참여가 제한된 닉네임입니다.";
    return;
  }

  localStorage.setItem(STORAGE_KEYS.nickname, nickname);
  try {
    await setDoc(doc(state.db, "oxQuiz", "participants", "items", nicknameKey(nickname)), {
      nickname,
      answer,
      questionId: state.currentQuestion.id,
      updatedAt: Date.now(),
    });
    els.answerLocked.classList.remove("hidden");
    els.answerLocked.textContent = `${answer}로 선택했습니다. 제한시간 안에는 다시 바꿀 수 있습니다.`;
  } catch (error) {
    els.answerLocked.classList.remove("hidden");
    els.answerLocked.textContent = `답안 저장 실패: ${error.code || ""} ${error.message}`;
  }
}

async function publishQuestion() {
  if (!state.connected) return;
  const id = makeId();
  const seconds = Number(els.timeLimit.value);
  const question = {
    id,
    text: els.questionText.value.trim(),
    correctAnswer: els.correctAnswer.value,
    timeLimit: seconds,
    maxWinners: Number(els.maxWinners.value),
    imageData: state.selectedImage,
    startsAt: Date.now(),
    endsAt: Date.now() + seconds * 1000,
  };
  try {
    await deleteDoc(doc(state.db, "oxQuiz", "lastResult"));
    await setDoc(doc(state.db, "oxQuiz", "current"), question);
    await clearCollection(collection(state.db, "oxQuiz", "participants", "items"));
    state.autoClosingId = "";
    els.connectionStatus.textContent = "문제를 출제했습니다. 참가자 화면에 곧 반영됩니다.";
  } catch (error) {
    els.connectionStatus.textContent = `문제 출제 실패: ${error.code || ""} ${error.message}`;
  }
}

async function closeCurrentQuestion() {
  if (!state.connected || !state.currentQuestion) return;
  try {
    const participantsSnapshot = await getDocs(collection(state.db, "oxQuiz", "participants", "items"));
    const participants = participantsSnapshot.docs.map((item) => item.data());
    const correct = participants
      .filter((item) => item.questionId === state.currentQuestion.id && item.answer === state.currentQuestion.correctAnswer)
      .map((item) => item.nickname);
    const winners = shuffle(correct).slice(0, state.currentQuestion.maxWinners);
    const record = {
      ...state.currentQuestion,
      closedAt: Date.now(),
      createdAt: Date.now(),
      totalAnswers: participants.filter((item) => item.questionId === state.currentQuestion.id).length,
      winners,
    };
    await setDoc(doc(state.db, "oxQuiz", "history", "items", state.currentQuestion.id), record);
    await setDoc(doc(state.db, "oxQuiz", "lastResult"), record);
    await deleteDoc(doc(state.db, "oxQuiz", "current"));
    await clearCollection(collection(state.db, "oxQuiz", "participants", "items"));
    els.connectionStatus.textContent = "문항을 마감하고 기록에 저장했습니다.";
  } catch (error) {
    els.connectionStatus.textContent = `마감 실패: ${error.code || ""} ${error.message}`;
  }
}

async function blockParticipant(participant) {
  if (!state.connected || !participant?.nickname) return;
  const key = nicknameKey(participant.nickname);
  try {
    await setDoc(doc(state.db, "oxQuiz", "blocked", "items", key), {
      nickname: participant.nickname,
      blockedAt: Date.now(),
    });
    await deleteDoc(doc(state.db, "oxQuiz", "participants", "items", key));
  } catch (error) {
    els.connectionStatus.textContent = `참여자 차단 실패: ${error.code || ""} ${error.message}`;
  }
}

function handleImageSelect(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.selectedImage = reader.result;
    els.imagePreview.src = state.selectedImage;
    els.imagePreviewWrap.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  state.selectedImage = "";
  els.questionImage.value = "";
  els.imagePreview.removeAttribute("src");
  els.imagePreviewWrap.classList.add("hidden");
}

function exportHistoryCsv() {
  const entries = Object.values(state.history);
  const rows = [["질문", "정답", "응답수", "당첨자", "기록시각"]];
  entries.forEach((item) => {
    rows.push([
      item.text || "",
      item.correctAnswer || "",
      item.totalAnswers || 0,
      (item.winners || []).join(", "),
      new Date(item.createdAt || Date.now()).toLocaleString("ko-KR"),
    ]);
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ox-quiz-history.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function deleteAllHistory() {
  if (!state.connected) return;
  const ok = confirm("출제 기록과 현재 표시 중인 마지막 결과를 모두 삭제할까요?");
  if (!ok) return;
  try {
    await clearCollection(collection(state.db, "oxQuiz", "history", "items"));
    await deleteDoc(doc(state.db, "oxQuiz", "lastResult"));
    els.connectionStatus.textContent = "출제 기록을 삭제했습니다.";
  } catch (error) {
    els.connectionStatus.textContent = `기록 삭제 실패: ${error.code || ""} ${error.message}`;
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  if (!state.connected) return;
  const text = els.chatInput.value.trim();
  if (!text) return;
  const nickname = normalizeNickname(els.nickname.value);
  const isAdmin = state.mode === "admin" && state.admin;
  if (!isAdmin && !nickname) {
    els.answerLocked.classList.remove("hidden");
    els.answerLocked.textContent = "채팅을 보내려면 닉네임을 먼저 입력하세요.";
    els.nickname.focus();
    return;
  }
  try {
    await setDoc(doc(state.db, "oxQuiz", "chat", "items", makeId()), {
      text,
      sender: isAdmin ? "관리자" : nickname,
      role: isAdmin ? "admin" : "player",
      createdAt: Date.now(),
    });
    els.chatInput.value = "";
    cleanupChatMessages();
  } catch (error) {
    els.connectionStatus.textContent = `채팅 전송 실패: ${error.code || ""} ${error.message}`;
  }
}

async function clearChatMessages() {
  if (!state.connected) return;
  const ok = confirm("현재 채팅을 모두 비울까요?");
  if (!ok) return;
  try {
    await clearCollection(collection(state.db, "oxQuiz", "chat", "items"));
    els.connectionStatus.textContent = "채팅을 비웠습니다.";
  } catch (error) {
    els.connectionStatus.textContent = `채팅 삭제 실패: ${error.code || ""} ${error.message}`;
  }
}

async function cleanupChatMessages() {
  const snapshot = await getDocs(query(collection(state.db, "oxQuiz", "chat", "items"), orderBy("createdAt", "asc")));
  const now = Date.now();
  const overflow = Math.max(0, snapshot.docs.length - 80);
  const batch = writeBatch(state.db);
  let deleteCount = 0;
  snapshot.docs.forEach((item, index) => {
    const createdAt = item.data().createdAt || 0;
    if (index < overflow || now - createdAt > 2 * 60 * 60 * 1000) {
      batch.delete(item.ref);
      deleteCount += 1;
    }
  });
  if (!deleteCount) return;
  await batch.commit();
}

function isQuestionActive(question) {
  return Boolean(question && question.endsAt > Date.now());
}

function normalizeNickname(value) {
  return value.trim().replace(/\s+/g, " ");
}

function nicknameKey(value) {
  return normalizeNickname(value).toLowerCase().replace(/[.#$\[\]/]/g, "_");
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function resultMessage(result) {
  const winners = result.winners?.length ? result.winners.join(", ") : "없음";
  return `마감되었습니다. 정답은 ${result.correctAnswer}입니다. 당첨자: ${winners}`;
}

function docsToObject(snapshot) {
  return Object.fromEntries(snapshot.docs.map((item) => [item.id, { id: item.id, ...item.data() }]));
}

function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function clearCollection(collectionRef) {
  const snapshot = await getDocs(collectionRef);
  if (snapshot.empty) return;
  const batch = writeBatch(state.db);
  snapshot.docs.forEach((item) => batch.delete(item.ref));
  await batch.commit();
}

init();
