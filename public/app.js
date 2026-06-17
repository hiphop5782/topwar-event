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

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxPImoRLB4zbQgzixoCts_q5_8zQva4QcyvBEXuSeIpl8FRjs8lneLJgXJEuiZEm7Bs/exec";
const LANGUAGES = [
  { code: "ko", label: "Korean", flag: "kr" },
  { code: "en", label: "English", flag: "us" },
  { code: "vi", label: "Vietnamese", flag: "vn" },
  { code: "ja", label: "Japanese", flag: "jp" },
  { code: "es", label: "Spanish", flag: "es" },
  { code: "pt", label: "Portuguese", flag: "pt" },
  { code: "ar", label: "Arabic", flag: "sa", dir: "rtl" },
  { code: "zh-CN", label: "Chinese", flag: "cn" }
];

let currentLanguage = "ko";
let translateLoading = false;
let koreanRestoreMap = new Map();
const TRANSLATE_SKIP_SELECTOR = [
  "[data-no-translate]",
  "script",
  "style",
  ".cell",
  ".participant strong",
  ".participant .chip",
  ".history-item strong",
  "#pickLimitText",
  "#participantCount",
  "#winnerCellText",
  "#myPickCount",
  "#myPickLimit"
].join(", ");

const params = new URLSearchParams(window.location.search);
let role = "user";

if (params.has("admin")) {
  role = window.prompt("관리자 비밀번호를 입력하세요.") === "3223" ? "admin" : "user";
}

document.body.dataset.role = role;

const elements = {
  board: document.querySelector("#board"),
  languageSwitcher: document.querySelector("#languageSwitcher"),
  toastRoot: document.querySelector("#toastRoot"),
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

localStorage.setItem("voteUserId", myId);
elements.nameInput.value = localStorage.getItem("voteUserName") || "";
elements.roleBadgeText.textContent = role === "admin" ? "관리자" : "사용자";

function renderLanguageSwitcher() {
  if (!elements.languageSwitcher) return;
  elements.languageSwitcher.innerHTML = LANGUAGES
    .map((language) =>
      "<button type=\"button\" class=\"language-button " + (language.code === currentLanguage ? "active" : "") + "\" data-language=\"" + language.code + "\" aria-label=\"" + language.label + "\" title=\"" + language.label + "\"><img class=\"flag-icon\" src=\"https://flagcdn.com/w40/" + language.flag + ".png\" srcset=\"https://flagcdn.com/w80/" + language.flag + ".png 2x\" width=\"40\" height=\"30\" alt=\"\" loading=\"lazy\" /></button>"
    )
    .join("");
}

function shouldSkipTranslateNode(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!element) return true;
  if (element.closest(TRANSLATE_SKIP_SELECTOR)) return true;
  const box = element.nodeType === Node.ELEMENT_NODE ? element.getBoundingClientRect() : null;
  const style = window.getComputedStyle(element);
  return style.display === "none" || style.visibility === "hidden" || (box && box.width === 0 && box.height === 0);
}

function isMeaningfulTranslateText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^[\d\s/.,:()-]+$/.test(text)) return false;
  if (/^\d+-\d+$/.test(text)) return false;
  return /[가-힣]/.test(text);
}

function rememberKoreanValue(id, value) {
  if (!koreanRestoreMap.has(id)) koreanRestoreMap.set(id, value);
}

function getElementPath(element) {
  if (element.id) return "#" + element.id;
  const parts = [];
  let current = element;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;
    const index = [...parent.children].indexOf(current) + 1;
    parts.unshift(current.tagName.toLowerCase() + ":nth-child(" + index + ")");
    current = parent;
  }
  return parts.join(" > ");
}

function collectTranslationPayload() {
  const payload = {};
  const targets = [];
  let index = 0;
  const walker = document.createTreeWalker(document.querySelector(".app"), NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkipTranslateNode(node)) return NodeFilter.FILTER_REJECT;
      return isMeaningfulTranslateText(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const key = "t" + index++;
    const id = "text:" + getElementPath(node.parentElement) + ":" + key;
    payload[key] = node.nodeValue.trim();
    targets.push({ type: "text", key, node, original: node.nodeValue });
    rememberKoreanValue(id, { type: "text", node, value: node.nodeValue });
  }
  document.querySelectorAll(".app input[placeholder]").forEach((input) => {
    if (shouldSkipTranslateNode(input)) return;
    const value = input.getAttribute("placeholder");
    if (!isMeaningfulTranslateText(value)) return;
    const key = "p" + index++;
    const id = "placeholder:" + getElementPath(input);
    payload[key] = value.trim();
    targets.push({ type: "placeholder", key, node: input, original: value });
    rememberKoreanValue(id, { type: "placeholder", node: input, value });
  });
  return { payload, targets };
}

function normalizeTranslationResult(result) {
  if (result?.data && typeof result.data === "object") return result.data;
  if (result?.result && typeof result.result === "object") return result.result;
  if (result?.translated && typeof result.translated === "object") return result.translated;
  return result;
}

function didTranslateChange(result, payload) {
  return Object.entries(payload).some(([key, value]) => {
    const translated = result?.[key];
    return typeof translated === "string" && translated.trim() && translated.trim() !== String(value).trim();
  });
}

function setTranslatePlaceholder(targets, enabled) {
  document.body.classList.toggle("is-translating", enabled);
  for (const target of targets) {
    const element = target.type === "text" ? target.node.parentElement : target.node;
    if (element) element.classList.toggle("translate-placeholder", enabled);
  }
}

function applyTranslatedPayload(result, targets) {
  for (const target of targets) {
    const value = result && result[target.key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (target.type === "text") target.node.nodeValue = target.original.replace(target.original.trim(), value.trim());
    if (target.type === "placeholder") target.node.setAttribute("placeholder", value.trim());
  }
}

function restoreKoreanText() {
  for (const item of koreanRestoreMap.values()) {
    if (!item.node || !item.node.isConnected) continue;
    if (item.type === "text") item.node.nodeValue = item.value;
    if (item.type === "placeholder") item.node.setAttribute("placeholder", item.value);
  }
  document.documentElement.lang = "ko";
  document.documentElement.dir = "ltr";
}

function showToast(message, variant = "error") {
  if (!elements.toastRoot) return;
  const toast = document.createElement("div");
  toast.className = "toast " + variant;
  toast.textContent = message;
  elements.toastRoot.append(toast);
  window.setTimeout(() => toast.classList.add("show"), 20);
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 220);
  }, 3600);
}

async function changeLanguage(code) {
  if (translateLoading || code === currentLanguage) return;
  const language = LANGUAGES.find((item) => item.code === code);
  if (!language) return;
  if (currentLanguage !== "ko") restoreKoreanText();
  currentLanguage = code;
  renderLanguageSwitcher();
  document.documentElement.lang = code;
  document.documentElement.dir = language.dir || "ltr";
  if (code === "ko") {
    restoreKoreanText();
    return;
  }
  const { payload, targets } = collectTranslationPayload();
  if (!Object.keys(payload).length) return;
  translateLoading = true;
  setTranslatePlaceholder(targets, true);
  try {
    const response = await fetch(SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "translate_all", target: code, data: payload })
    });
    const rawResult = await response.json();
    if (rawResult.error) throw new Error(rawResult.error);
    const result = normalizeTranslationResult(rawResult);
    if (!didTranslateChange(result, payload)) {
      throw new Error("Translation server returned the original text unchanged.");
    }
    applyTranslatedPayload(result, targets);
  } catch (error) {
    console.error("Translation failed:", error);
    restoreKoreanText();
    currentLanguage = "ko";
    renderLanguageSwitcher();
    showToast(error.message || "Translation failed. Please try again.");
  } finally {
    translateLoading = false;
    setTranslatePlaceholder(targets, false);
  }
}

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
  return state.users.filter((user) => (user.picks || []).includes(state.winnerCell));
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
    ? entry.winners.map((winner) => winner.name).join(", ")
    : "당첨자 없음";

  return `
    <article class="history-item ${isLatest ? "latest" : ""}">
      <strong>${cellLabel(entry.cell)}</strong>
      <span>${time}</span>
      <p>${escapeHtml(winnerNames)}</p>
    </article>
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
    state = normalizeState(snapshot.data());
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
  await setDoc(
    stateRef,
    {
      picksPerUser,
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

    const winners = state.users
      .filter((user) => (user.picks || []).includes(cell))
      .map((user) => ({ id: user.id, name: user.name }));
    const entry = {
      id: createId(),
      cell,
      winners,
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

elements.languageSwitcher?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-language]");
  if (button) changeLanguage(button.dataset.language);
});

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

renderLanguageSwitcher();
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
