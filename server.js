import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);

const initialState = () => ({
  phase: "ready",
  picksPerUser: 3,
  winnerCell: null,
  boardImageUrl: "/map.png",
  users: {},
  drawHistory: [],
  forbiddenCells: []
});

let state = initialState();
const clients = new Set();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function sortedUsers() {
  return Object.values(state.users).sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function publicState() {
  return {
    phase: state.phase,
    picksPerUser: state.picksPerUser,
    winnerCell: state.winnerCell,
    boardImageUrl: state.boardImageUrl,
    users: sortedUsers(),
    drawHistory: state.drawHistory,
    forbiddenCells: state.forbiddenCells
  };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function sanitizeName(name) {
  return String(name || "").trim().slice(0, 24);
}

function sanitizeImageUrl(url) {
  return String(url || "").trim().slice(0, 1000);
}

function normalizeCells(cells) {
  if (!Array.isArray(cells)) return [];
  const unique = [...new Set(cells.map(Number))];
  return unique.filter((cell) => Number.isInteger(cell) && cell >= 0 && cell < 64);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function winnersForCell(cell) {
  return sortedUsers()
    .filter((user) => user.picks.includes(cell))
    .map((user) => ({ id: user.id, name: user.name }));
}

function removeForbiddenFromUserPicks() {
  const forbidden = new Set(state.forbiddenCells);
  for (const user of Object.values(state.users)) {
    const nextPicks = user.picks.filter((pick) => !forbidden.has(pick)).slice(0, state.picksPerUser);
    if (nextPicks.length !== user.picks.length) {
      user.picks = nextPicks;
      user.updatedAt = Date.now();
    }
  }
}

function trimUserPicksToLimit() {
  for (const user of Object.values(state.users)) {
    if (user.picks.length > state.picksPerUser) {
      user.picks = user.picks.slice(0, state.picksPerUser);
      user.updatedAt = Date.now();
    }
  }
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const resolved = path.normalize(path.join(publicDir, pathname));

  if (!resolved.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(resolved)] || "application/octet-stream"
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "GET" && requestUrl.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      });
      response.write(`data: ${JSON.stringify(publicState())}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/state") {
      sendJson(response, 200, publicState());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/settings") {
      const body = await readBody(request);
      const nextPhase = body.phase === "locked" || body.phase === "drawn" ? body.phase : "ready";
      state.picksPerUser = Math.max(1, Math.min(64, Number(body.picksPerUser) || 1));
      state.boardImageUrl = sanitizeImageUrl(body.boardImageUrl) || "/map.png";
      state.phase = nextPhase;
      if (state.phase !== "drawn") state.winnerCell = null;
      trimUserPicksToLimit();
      broadcast();
      sendJson(response, 200, publicState());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/reset") {
      state = initialState();
      broadcast();
      sendJson(response, 200, publicState());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/forbidden") {
      const body = await readBody(request);
      const cell = Number(body.cell);
      if (!Number.isInteger(cell) || cell < 0 || cell >= 64) {
        sendJson(response, 400, { error: "잘못된 칸입니다." });
        return;
      }

      if (state.forbiddenCells.includes(cell)) {
        state.forbiddenCells = state.forbiddenCells.filter((item) => item !== cell);
      } else {
        state.forbiddenCells = [...state.forbiddenCells, cell].sort((a, b) => a - b);
      }

      removeForbiddenFromUserPicks();
      broadcast();
      sendJson(response, 200, publicState());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/admin/draw") {
      const body = await readBody(request);
      const cell = Number(body.cell);
      if (!Number.isInteger(cell) || cell < 0 || cell >= 64) {
        sendJson(response, 400, { error: "잘못된 칸입니다." });
        return;
      }
      if (state.forbiddenCells.includes(cell)) {
        sendJson(response, 409, { error: "선택 금지 칸은 당첨 칸으로 발표할 수 없습니다." });
        return;
      }

      const winners = winnersForCell(cell);
      state.phase = "drawn";
      state.winnerCell = cell;
      state.drawHistory.unshift({
        id: randomUUID(),
        cell,
        winners,
        drawnAt: new Date().toISOString()
      });
      broadcast();
      sendJson(response, 200, publicState());
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/api/user/picks") {
      const body = await readBody(request);
      if (state.phase !== "ready") {
        sendJson(response, 409, { error: "지금은 선택을 변경할 수 없습니다." });
        return;
      }

      const id = String(body.id || randomUUID());
      const name = sanitizeName(body.name);
      const picks = normalizeCells(body.picks).slice(0, state.picksPerUser);
      const forbidden = new Set(state.forbiddenCells);

      if (!name) {
        sendJson(response, 400, { error: "이름을 입력해 주세요." });
        return;
      }
      if (picks.some((pick) => forbidden.has(pick))) {
        sendJson(response, 400, { error: "선택 금지 칸은 고를 수 없습니다." });
        return;
      }
      if (picks.length !== state.picksPerUser) {
        sendJson(response, 400, { error: `${state.picksPerUser}개를 선택해 주세요.` });
        return;
      }

      state.users[id] = { id, name, picks, updatedAt: Date.now() };
      broadcast();
      sendJson(response, 200, { id, state: publicState() });
      return;
    }

    if (request.method === "GET") {
      serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: "서버에서 문제가 발생했습니다." });
  }
});

server.listen(port, () => {
  console.log(`8x8 live vote is running at http://localhost:${port}`);
});
