const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

const PORT = Number(process.env.PORT) || 8080;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const SHARED_DATA_FILE = path.join(DATA_DIR, "shared-data.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function validateSharedPayload(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (!payload.stageQuestions || typeof payload.stageQuestions !== "object") return false;
  if (!payload.stageEstimation || typeof payload.stageEstimation !== "object") return false;
  return true;
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

async function handleSharedData(req, res) {
  if (req.method === "GET") {
    try {
      const raw = await fsp.readFile(SHARED_DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      sendJson(res, 200, parsed);
    } catch (err) {
      if (err && err.code === "ENOENT") {
        sendJson(res, 404, { error: "No shared data yet." });
        return;
      }
      sendJson(res, 500, { error: "Failed to read shared data." });
    }
    return;
  }

  if (req.method === "PUT") {
    try {
      const rawBody = await readRequestBody(req);
      const parsed = JSON.parse(rawBody);
      if (!validateSharedPayload(parsed)) {
        sendJson(res, 400, { error: "Invalid shared data format." });
        return;
      }

      await ensureDataDir();
      const normalized = JSON.stringify(
        {
          version: Number(parsed.version) || 1,
          savedAt: parsed.savedAt || new Date().toISOString(),
          stageQuestions: parsed.stageQuestions,
          stageEstimation: parsed.stageEstimation
        },
        null,
        2
      );

      await fsp.writeFile(SHARED_DATA_FILE, normalized, "utf8");
      sendJson(res, 200, { ok: true });
    } catch (_) {
      sendJson(res, 500, { error: "Failed to save shared data." });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed." });
}

async function serveStatic(urlPath, res) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const filePath = path.normalize(path.join(ROOT_DIR, requested));

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    const data = await fsp.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  } catch (_) {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = req.url || "/";
  const pathname = reqUrl.split("?")[0];

  if (pathname === "/api/shared-data") {
    await handleSharedData(req, res);
    return;
  }

  await serveStatic(pathname, res);
});

server.listen(PORT, () => {
  console.log(`Family Feud server running on http://localhost:${PORT}`);
});
