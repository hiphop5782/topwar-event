import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { eventId, firebaseConfig } from "./firebase-config.js";

const params = new URLSearchParams(window.location.search);
let role = "user";

if (params.has("admin")) {
  role = window.prompt("관리자 비밀번호를 입력하세요.") === "3223" ? "admin" : "user";
}

document.body.dataset.role = role;

const elements = {
  board: document.querySelector("#board"),
  roleBadgeText: document.querySelector("#roleBadgeText"),
  phaseText: document.querySelector("#phaseText"),
  pickLimitText: document.querySelector("#pickLimitText"),
  participantCount: document.querySelector("#participantCount"),
  winnerBanner: document.querySelector("#winnerBanner"),
  winnerCellText: document.querySelector("#winnerCellText"),
  winnerNamesText: document.querySelector("#winnerNamesText"),
  nameInput: document.querySelector("#nameInput"),
  myPickCount: document.querySelector("#myPickCount"),
  myPickLimit: document.querySelector("#myPickLimit"),
  myPicks: document.querySelector("#myPicks"),
  submitPicks: document.querySelector("#submitPicks"),
  userMessage: document.querySelector("#userMessage"),
  pickLimitInput: document.querySelector("#pickLimitInput"),
  allowDuplicateWinnersInput: document.querySelector("#allowDuplicateWinnersInput"),
  applySettings: document.querySelector("#applySettings"),
  forbiddenModeToggle: document.querySelector("#forbiddenModeToggle"),
  openVoting: document.querySelector("#openVoting"),
  lockVoting: document.querySelector("#lockVoting"),
  resetPicksOnly: document.querySelector("#resetPicksOnly"),
  resetAll: document.querySelector("#resetAll"),
  adminMessage: document.querySelector("#adminMessage"),
  participantsList: document.querySelector("#participantsList"),
  selectedCellsSummary: document.querySelector("#selectedCellsSummary"),
  historyList: document.querySelector("#historyList"),
  historySummary: document.querySelector("#historySummary")
};

const defaultState = {
  phase: "ready",
  picksPerUser: 3,
  winnerCell: null,
  boardImageUrl: "map.png",
  drawHistory: [],
  forbiddenCells: [],
  allowDuplicateWinners: true,
  resetId: "initial"
};
const phaseLabels = {
  ready: "선택 진행 중",
  locked: "선택 마감",
  drawn: "당첨 발표"
};

let db = null;
let stateRef = null;
let usersRef = null;
let state = { ...defaultState, users: [] };
let myId = localStorage.getItem("voteUserId") || createId();
let myPicks = [];
let forbiddenEditMode = false;
let firebaseReady = false;
let hasReceivedState = false;
let lastCelebratedWinnerKey = null;

localStorage.setItem("voteUserId", myId);
elements.nameInput.value = localStorage.getItem("voteUserName") || "";
elements.roleBadgeText.textContent = role === "admin" ? "관리자" : "사용자";

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const randomPart = Array.from(globalThis.crypto?.getRandomValues?.(new Uint8Array(16)) || [])
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `id-${Date.now().toString(36)}-${randomPart || Math.random().toString(36).slice(2)}`;
}

function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

function cellLabel(index) {
  const row = Math.floor(index / 8) + 1;
  const col = (index % 8) + 1;
  return `${row}-${col}`;
}

function normalizeState(data = {}) {
  return {
    ...defaultState,
    ...data,
    picksPerUser: Math.max(1, Math.min(64, Number(data.picksPerUser) || defaultState.picksPerUser)),
    drawHistory: Array.isArray(data.drawHistory) ? data.drawHistory : [],
    forbiddenCells: Array.isArray(data.forbiddenCells) ? data.forbiddenCells : [],
    allowDuplicateWinners: data.allowDuplicateWinners !== false,
    resetId: data.resetId || defaultState.resetId,
    users: state.users
  };
}

function buildBoard() {
  elements.board.innerHTML = "";
  for (let index = 0; index < 64; index += 1) {
    const button = document.createElement("button");
    button.className = "cell";
    button.type = "button";
    button.dataset.cell = String(index);
    button.setAttribute("aria-label", `${cellLabel(index)} 칸`);
    button.addEventListener("click", () => handleCellClick(index));
    elements.board.append(button);
  }
}

function countByCell() {
  const counts = new Map();
  for (const user of state.users) {
    for (const pick of user.picks || []) counts.set(pick, (counts.get(pick) || 0) + 1);
  }
  return counts;
}

function winningUsers() {
  if (state.winnerCell === null) return [];
  const latestEntry = state.drawHistory?.[0];
  if (latestEntry?.cell === state.winnerCell && Array.isArray(latestEntry.winners)) {
    const winnerIds = new Set(latestEntry.winners.map((winner) => winner.id));
    return state.users.filter((user) => winnerIds.has(user.id));
  }
  return rankedWinnersForCell(state.winnerCell).map((winner) => winner.user);
}

function renderBoard() {
  const counts = countByCell();
  const usersByCell = usersGroupedByCell();
  const forbidden = new Set(state.forbiddenCells || []);
  const boardImageUrl = state.boardImageUrl || "map.png";
  elements.board.style.backgroundImage = `url("${boardImageUrl}")`;
  elements.board.classList.add("has-image");
  elements.board.classList.toggle("forbidden-editing", forbiddenEditMode);

  document.querySelectorAll(".cell").forEach((cell) => {
    const index = Number(cell.dataset.cell);
    const count = counts.get(index) || 0;
    const users = usersByCell.get(index) || [];
    const isForbidden = forbidden.has(index);
    cell.classList.toggle("selected", myPicks.includes(index));
    cell.classList.toggle("has-picks", count > 0);
    cell.classList.toggle("winner", state.winnerCell === index);
    cell.classList.toggle("forbidden", isForbidden);
    cell.dataset.count = count ? String(count) : "";
    cell.dataset.names = users.length ? users.map((user) => user.name).join(", ") : "";
    cell.setAttribute("aria-label", `${cellLabel(index)} 칸${users.length ? `, 선택자 ${users.map((user) => user.name).join(", ")}` : ""}`);
    cell.disabled = role === "user" && (state.phase !== "ready" || isForbidden);
  });
}

function usersGroupedByCell() {
  const groups = new Map();
  for (const user of state.users) {
    for (const pick of user.picks || []) {
      const users = groups.get(pick) || [];
      users.push(user);
      groups.set(pick, users);
    }
  }
  return groups;
}

function renderUserPanel() {
  elements.pickLimitText.textContent = state.picksPerUser;
  elements.myPickLimit.textContent = state.picksPerUser;
  elements.myPickCount.textContent = myPicks.length;
  elements.myPicks.innerHTML = myPicks.length
    ? myPicks.map((pick) => `<span class="chip">${cellLabel(pick)}</span>`).join("")
    : `<span class="chip">선택 없음</span>`;
  elements.submitPicks.disabled = state.phase !== "ready" || !firebaseReady;
}

function renderAdminPanel() {
  if (document.activeElement !== elements.pickLimitInput) {
    elements.pickLimitInput.value = state.picksPerUser;
  }
  elements.allowDuplicateWinnersInput.checked = state.allowDuplicateWinners !== false;
  elements.applySettings.disabled = !firebaseReady;
  elements.openVoting.disabled = state.phase === "ready" || !firebaseReady;
  elements.lockVoting.disabled = state.phase !== "ready" || !firebaseReady;
  elements.resetPicksOnly.disabled = !firebaseReady;
  elements.resetAll.disabled = !firebaseReady;
  elements.forbiddenModeToggle.disabled = !firebaseReady;
  elements.forbiddenModeToggle.classList.toggle("active", forbiddenEditMode);
  elements.forbiddenModeToggle.textContent = forbiddenEditMode ? "선택 금지 편집 중" : "선택 금지 칸 편집";
}

function renderParticipants() {
  const winners = new Set(winningUsers().map((user) => user.id));
  elements.participantCount.textContent = state.users.length;
  elements.participantsList.innerHTML = state.users.length
    ? state.users
        .map(
          (user) => `
            <article class="participant ${winners.has(user.id) ? "winner" : ""}">
              <strong>${escapeHtml(user.name)}</strong>
              <div class="chips">
                ${(user.picks || []).map((pick) => `<span class="chip">${cellLabel(pick)}</span>`).join("")}
              </div>
            </article>
          `
        )
        .join("")
    : `<p class="message">아직 참여자가 없습니다.</p>`;

  const counts = [...countByCell().entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const forbiddenCount = state.forbiddenCells?.length || 0;
  elements.selectedCellsSummary.textContent = counts.length
    ? `가장 많이 선택된 칸: ${cellLabel(counts[0][0])} (${counts[0][1]}명), 선택 금지 ${forbiddenCount}칸`
    : `선택 금지 ${forbiddenCount}칸`;
}

function renderWinner() {
  const winners = winningUsers();
  const hasWinner = state.phase === "drawn" && state.winnerCell !== null;
  elements.winnerBanner.hidden = !hasWinner;
  if (!hasWinner) return;

  elements.winnerCellText.textContent = cellLabel(state.winnerCell);
  const latestEntry = state.drawHistory?.[0];
  const rankedWinners = latestEntry?.cell === state.winnerCell ? latestEntry.winners || [] : rankWinnerUsers(winners);
  elements.winnerNamesText.innerHTML = rankedWinners.length
    ? `<span class="winner-list-title">당첨자</span>${renderWinnerList(rankedWinners)}`
    : "해당 칸을 선택한 사용자가 없습니다.";
  return;
  elements.winnerNamesText.textContent = winners.length
    ? `당첨자: ${winners.map((user) => user.name).join(", ")}`
    : "해당 칸을 선택한 사용자가 없습니다.";
}

function historyCard(entry, isLatest = false) {
  const time = new Date(entry.drawnAt).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const winnerNames = entry.winners?.length
    ? entry.winners.map((winner) => `${winner.rank || "-"}위 ${winner.name}`).join(", ")
    : "당첨자 없음";

  return `
    <article class="history-item ${isLatest ? "latest" : ""}">
      <strong>${cellLabel(entry.cell)}</strong>
      <span>${time}</span>
      <p>${escapeHtml(winnerNames)}</p>
    </article>
  `;
}

function renderWinnerList(winners) {
  return `
    <ol class="winner-list">
      ${winners
        .map(
          (winner) => `
            <li>
              <span class="winner-rank">${winner.rank}위</span>
              <strong>${escapeHtml(winner.name)}</strong>
            </li>
          `
        )
        .join("")}
    </ol>
  `;
}

function renderHistory() {
  const [latest, ...older] = state.drawHistory;
  elements.historySummary.textContent = state.drawHistory.length
    ? `총 ${state.drawHistory.length}회 발표`
    : "아직 발표 기록이 없습니다.";

  if (!latest) {
    elements.historyList.innerHTML = `<p class="message">관리자가 칸을 발표하면 여기에 기록됩니다.</p>`;
    return;
  }

  elements.historyList.innerHTML = `
    <div class="history-list">
      ${historyCard(latest, true)}
    </div>
    ${
      older.length
        ? `
          <details class="history-archive">
            <summary>이전 당첨 내역 ${older.length}개 보기</summary>
            <div class="history-list archive-list">
              ${older.map((entry) => historyCard(entry)).join("")}
            </div>
          </details>
        `
        : ""
    }
  `;
}

function render() {
  elements.phaseText.textContent = phaseLabels[state.phase] || "준비 중";
  renderBoard();
  renderUserPanel();
  renderAdminPanel();
  renderParticipants();
  renderWinner();
  renderHistory();
}

function handleCellClick(index) {
  if (role === "admin") {
    if (forbiddenEditMode) {
      toggleForbiddenCell(index);
      return;
    }
    draw(index);
    return;
  }

  const forbidden = new Set(state.forbiddenCells || []);
  if (state.phase !== "ready" || forbidden.has(index)) return;
  elements.userMessage.textContent = "";
  elements.userMessage.classList.remove("error");

  if (myPicks.includes(index)) {
    myPicks = myPicks.filter((pick) => pick !== index);
  } else if (myPicks.length < state.picksPerUser) {
    myPicks = [...myPicks, index];
  } else {
    elements.userMessage.textContent = `${state.picksPerUser}개까지만 선택할 수 있습니다.`;
    elements.userMessage.classList.add("error");
  }
  render();
}

async function ensureFirebaseReady() {
  if (!isFirebaseConfigured()) {
    const message = "Firebase 설정이 필요합니다. public/firebase-config.js에 Firebase 웹 앱 설정값을 입력해 주세요.";
    elements.userMessage.textContent = message;
    elements.userMessage.classList.add("error");
    elements.adminMessage.textContent = message;
    elements.adminMessage.classList.add("error");
    render();
    return;
  }

  const app = initializeApp(firebaseConfig);
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
    useFetchStreams: false
  });
  stateRef = doc(db, "events", eventId);
  usersRef = collection(db, "events", eventId, "users");
  firebaseReady = true;

  const snapshot = await getDoc(stateRef);
  if (!snapshot.exists()) {
    await setDoc(stateRef, { ...defaultState, updatedAt: serverTimestamp() });
  }

  onSnapshot(stateRef, (snapshot) => {
    const nextState = normalizeState(snapshot.data());
    maybeCelebrateWinner(nextState);
    state = nextState;
    syncResetState();
    syncMyLocalPicks();
    render();
  });

  onSnapshot(usersRef, (snapshot) => {
    state.users = snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
    const myRecord = state.users.find((user) => user.id === myId);
    if (myRecord) {
      elements.nameInput.value = myRecord.name || elements.nameInput.value;
      localStorage.setItem("voteUserName", elements.nameInput.value);
      myPicks = [...(myRecord.picks || [])];
    }
    syncMyLocalPicks();
    render();
  });
}

function syncMyLocalPicks() {
  const forbidden = new Set(state.forbiddenCells || []);
  myPicks = myPicks.filter((pick) => !forbidden.has(pick)).slice(0, state.picksPerUser);
}

function maybeCelebrateWinner(nextState) {
  const latestHistoryId = nextState.drawHistory?.[0]?.id || "no-history";
  const nextWinnerKey =
    nextState.phase === "drawn" && nextState.winnerCell !== null
      ? `${nextState.winnerCell}-${latestHistoryId}`
      : null;

  if (hasReceivedState && nextWinnerKey && nextWinnerKey !== lastCelebratedWinnerKey) {
    launchCelebration(cellLabel(nextState.winnerCell));
  }

  lastCelebratedWinnerKey = nextWinnerKey;
  hasReceivedState = true;
}

function launchCelebration(winnerLabel) {
  document.querySelector(".celebration-layer")?.remove();

  const layer = document.createElement("div");
  layer.className = "celebration-layer";
  layer.innerHTML = `
    <div class="celebration-card">
      <span>당첨 발표</span>
      <strong>${winnerLabel}</strong>
      <p>축하합니다</p>
    </div>
  `;

  const colors = ["#e1192d", "#246bfe", "#ffc83d", "#18845b", "#ffffff"];
  for (let index = 0; index < 96; index += 1) {
    const piece = document.createElement("i");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty("--confetti-x", `${Math.random() * 220 - 110}px`);
    piece.style.setProperty("--confetti-rotate", `${Math.random() * 720 - 360}deg`);
    piece.style.setProperty("--confetti-delay", `${Math.random() * 0.3}s`);
    piece.style.setProperty("--confetti-duration", `${1.8 + Math.random() * 1.2}s`);
    piece.style.background = colors[index % colors.length];
    layer.append(piece);
  }

  document.body.append(layer);
  elements.winnerBanner.classList.add("celebrate");

  setTimeout(() => {
    layer.remove();
    elements.winnerBanner.classList.remove("celebrate");
  }, 3600);
}

function syncResetState() {
  const lastResetId = localStorage.getItem("voteResetId");
  if (state.resetId && lastResetId && state.resetId !== lastResetId) {
    myPicks = [];
  }
  if (state.resetId) {
    localStorage.setItem("voteResetId", state.resetId);
  }
}

async function savePicks() {
  try {
    const name = elements.nameInput.value.trim();
    const forbidden = new Set(state.forbiddenCells || []);
    if (!name) throw new Error("이름을 입력해 주세요.");
    if (myPicks.some((pick) => forbidden.has(pick))) throw new Error("선택 금지 칸은 고를 수 없습니다.");
    if (myPicks.length !== state.picksPerUser) throw new Error(`${state.picksPerUser}개를 선택해 주세요.`);

    localStorage.setItem("voteUserName", name);
    await setDoc(doc(usersRef, myId), {
      id: myId,
      name,
      picks: myPicks,
      submittedAt: Date.now(),
      updatedAt: serverTimestamp()
    });
    elements.userMessage.textContent = "선택이 저장되었습니다.";
    elements.userMessage.classList.remove("error");
  } catch (error) {
    elements.userMessage.textContent = error.message;
    elements.userMessage.classList.add("error");
  }
}

async function trimUsersToCurrentRules(nextLimit = state.picksPerUser, forbiddenCells = state.forbiddenCells) {
  const forbidden = new Set(forbiddenCells || []);
  const snapshot = await getDocs(usersRef);
  const batch = writeBatch(db);
  let changed = false;
  snapshot.docs.forEach((item) => {
    const user = item.data();
    const nextPicks = (user.picks || []).filter((pick) => !forbidden.has(pick)).slice(0, nextLimit);
    if (JSON.stringify(nextPicks) !== JSON.stringify(user.picks || [])) {
      batch.set(item.ref, { picks: nextPicks, updatedAt: serverTimestamp() }, { merge: true });
      changed = true;
    }
  });
  if (changed) await batch.commit();
}

async function updateSettings(phase = state.phase) {
  const picksPerUser = Math.max(1, Math.min(64, Number(elements.pickLimitInput.value) || 1));
  const allowDuplicateWinners = elements.allowDuplicateWinnersInput.checked;
  await setDoc(
    stateRef,
    {
      picksPerUser,
      allowDuplicateWinners,
      phase,
      winnerCell: phase === "drawn" ? state.winnerCell : null,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  await trimUsersToCurrentRules(picksPerUser, state.forbiddenCells);
  elements.adminMessage.textContent = "설정이 모든 화면에 적용되었습니다.";
  elements.adminMessage.classList.remove("error");
}

async function toggleForbiddenCell(cell) {
  try {
    const current = new Set(state.forbiddenCells || []);
    if (current.has(cell)) current.delete(cell);
    else current.add(cell);
    const forbiddenCells = [...current].sort((a, b) => a - b);

    await setDoc(stateRef, { forbiddenCells, updatedAt: serverTimestamp() }, { merge: true });
    await trimUsersToCurrentRules(state.picksPerUser, forbiddenCells);
    elements.adminMessage.textContent = "선택 금지 칸이 갱신되었습니다.";
    elements.adminMessage.classList.remove("error");
  } catch (error) {
    elements.adminMessage.textContent = error.message;
    elements.adminMessage.classList.add("error");
  }
}

async function draw(cell) {
  try {
    if ((state.forbiddenCells || []).includes(cell)) {
      throw new Error("선택 금지 칸은 당첨 칸으로 발표할 수 없습니다.");
    }
    if (state.phase === "ready" && !confirm("선택을 마감하고 이 칸을 당첨 칸으로 발표할까요?")) {
      return;
    }

    const winners = rankedWinnersForCell(cell, state.allowDuplicateWinners !== false).map(({ user, ...winner }) => winner);
    const entry = {
      id: createId(),
      cell,
      winners,
      allowDuplicateWinners: state.allowDuplicateWinners !== false,
      drawnAt: new Date().toISOString()
    };

    await setDoc(
      stateRef,
      {
        phase: "drawn",
        winnerCell: cell,
        drawHistory: [entry, ...(state.drawHistory || [])],
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  } catch (error) {
    elements.adminMessage.textContent = error.message;
    elements.adminMessage.classList.add("error");
  }
}

function rankedWinnersForCell(cell, allowDuplicateWinners = state.allowDuplicateWinners !== false) {
  const previousWinnerIds = allowDuplicateWinners ? new Set() : previouslyWonUserIds();
  const users = state.users
    .filter((user) => (user.picks || []).includes(cell))
    .filter((user) => !previousWinnerIds.has(user.id))
    .sort((a, b) => userSelectedAt(a) - userSelectedAt(b) || String(a.name || "").localeCompare(String(b.name || ""), "ko"));

  return rankWinnerUsers(users);
}

function rankWinnerUsers(users) {
  let previousTime = null;
  let currentRank = 0;
  return users.map((user, index) => {
    const selectedAt = userSelectedAt(user);
    if (previousTime === null || selectedAt !== previousTime) {
      currentRank = index + 1;
      previousTime = selectedAt;
    }
    return {
      id: user.id,
      name: user.name,
      rank: currentRank,
      selectedAt,
      user
    };
  });
}

function previouslyWonUserIds() {
  const ids = new Set();
  for (const entry of state.drawHistory || []) {
    for (const winner of entry.winners || []) {
      ids.add(winner.id);
    }
  }
  return ids;
}

function userSelectedAt(user) {
  if (typeof user.submittedAt === "number") return user.submittedAt;
  if (typeof user.updatedAt?.toMillis === "function") return user.updatedAt.toMillis();
  if (typeof user.updatedAt === "number") return user.updatedAt;
  return 0;
}

async function resetAll() {
  const users = await getDocs(usersRef);
  const batch = writeBatch(db);
  users.docs.forEach((item) => batch.delete(item.ref));
  batch.set(stateRef, { ...defaultState, resetId: createId(), updatedAt: serverTimestamp() });
  await batch.commit();
}

async function resetPicksOnly() {
  const users = await getDocs(usersRef);
  const batch = writeBatch(db);
  users.docs.forEach((item) => batch.delete(item.ref));
  batch.set(
    stateRef,
    {
      phase: "ready",
      winnerCell: null,
      resetId: createId(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  await batch.commit();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

elements.nameInput.addEventListener("input", () => {
  localStorage.setItem("voteUserName", elements.nameInput.value);
});
elements.submitPicks.addEventListener("click", savePicks);
elements.applySettings.addEventListener("click", async () => {
  try {
    await updateSettings();
  } catch (error) {
    elements.adminMessage.textContent = error.message;
    elements.adminMessage.classList.add("error");
  }
});
elements.allowDuplicateWinnersInput.addEventListener("change", async () => {
  try {
    await updateSettings();
  } catch (error) {
    elements.adminMessage.textContent = error.message;
    elements.adminMessage.classList.add("error");
  }
});
elements.forbiddenModeToggle.addEventListener("click", () => {
  forbiddenEditMode = !forbiddenEditMode;
  elements.adminMessage.textContent = forbiddenEditMode
    ? "보드에서 선택 금지로 만들 칸을 누르세요."
    : "관리자는 보드 칸을 눌러 당첨 칸을 발표할 수 있습니다.";
  render();
});
elements.openVoting.addEventListener("click", () => updateSettings("ready"));
elements.lockVoting.addEventListener("click", () => updateSettings("locked"));
elements.resetPicksOnly.addEventListener("click", async () => {
  if (confirm("당첨 내역과 금지 칸은 유지하고 사용자 선택만 초기화할까요?")) {
    myPicks = [];
    forbiddenEditMode = false;
    await resetPicksOnly();
  }
});
elements.resetAll.addEventListener("click", async () => {
  if (confirm("참여자, 당첨 내역, 선택 금지 칸을 모두 초기화할까요?")) {
    myPicks = [];
    forbiddenEditMode = false;
    await resetAll();
  }
});

buildBoard();
render();
ensureFirebaseReady().catch((error) => {
  const message = `Firebase 연결에 실패했습니다: ${error.message}`;
  elements.userMessage.textContent = message;
  elements.userMessage.classList.add("error");
  elements.adminMessage.textContent = message;
  elements.adminMessage.classList.add("error");
  render();
});
