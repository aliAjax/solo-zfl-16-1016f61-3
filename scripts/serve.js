#!/usr/bin/env node
/**
 * 零依赖本地静态服务：供「活字排版工坊」预览使用。
 *
 *   npm start                # 默认 http://localhost:8000
 *   PORT=3000 npm start      # 自定义端口
 *   HOST=0.0.0.0 npm start   # 自定义监听地址
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || "localhost";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendError(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`${status} ${message}`);
}

function renderDirectory(res, dirPath, urlPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("._"))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  const rows = entries.map((entry) => {
    const name = entry.isDirectory() ? `${entry.name}/` : entry.name;
    const href = path.posix.join(urlPath, name);
    return `<li><a href="${escapeHtml(href)}">${escapeHtml(name)}</a></li>`;
  });
  const title = urlPath === "/" ? "活字排版工坊" : urlPath;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8" /><title>${escapeHtml(title)}</title></head>
<body style="font-family: sans-serif; padding: 24px">
  <h2>活字排版工坊 — 文件</h2>
  ${urlPath === "/" ? "" : '<p><a href="..">..</a></p>'}
  <ul>${rows.join("")}</ul>
</body>
</html>`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const decodedPath = decodeURIComponent(url.pathname);

  // 解析后校验真实路径，防止 %2e%2e / 编码斜杠等路径穿越
  const resolved = path.resolve(ROOT, `.${decodedPath}`);
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) {
    sendError(res, 403, "Forbidden");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    sendError(res, 404, "Not Found");
    return;
  }

  if (stat.isDirectory()) {
    const indexFile = path.join(resolved, "index.html");
    if (fs.existsSync(indexFile)) {
      serveFile(res, indexFile);
    } else {
      renderDirectory(res, resolved, decodedPath.endsWith("/") ? decodedPath : `${decodedPath}/`);
    }
    return;
  }
  serveFile(res, resolved);
});

function serveFile(res, filePath) {
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    sendError(res, 404, "Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": "no-cache"
  });
  res.end(data);
}

server.listen(PORT, HOST, () => {
  console.log(`活字排版工坊本地服务已启动：`);
  console.log(`  http://${HOST}:${PORT}/`);
  console.log(`按 Ctrl+C 停止。`);
});
