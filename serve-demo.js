/*
 * CSPD demo 一键启动（无需 npm install，只用 Node.js 自带功能）
 * 双击「启动DEMO.bat」（Windows）或「启动DEMO.command」（macOS）即会运行本脚本。
 * 也可以手动执行：node serve-demo.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, 'dist', 'cspd-demo', 'browser');
const PORT_START = 4200;
const PORT_END = 4210;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, headers) {
  res.writeHead(status, headers || { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 500, '读取文件失败');
      return;
    }
    send(res, 200, data, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  });
}

function handleRequest(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    send(res, 400, '无法识别的地址');
    return;
  }

  let filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, '不允许的访问');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      serveFile(res, filePath);
      return;
    }
    if (!err && stat.isFile()) {
      serveFile(res, filePath);
      return;
    }
    // SPA 回退：找不到文件且地址不带扩展名时，交回前端首页，由 demo 内部路由处理
    if (!path.extname(urlPath)) {
      serveFile(res, path.join(ROOT, 'index.html'));
      return;
    }
    send(res, 404, '文件不存在：' + urlPath);
  });
}

function openBrowser(url) {
  let command;
  if (process.platform === 'win32') {
    command = 'start "" "' + url + '"';
  } else if (process.platform === 'darwin') {
    command = 'open "' + url + '"';
  } else {
    command = 'xdg-open "' + url + '"';
  }
  exec(command, () => {
    /* 打不开浏览器也不影响使用，用户可手动复制地址 */
  });
}

function tryListen(port) {
  const server = http.createServer(handleRequest);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < PORT_END) {
      console.log('端口 ' + port + ' 被占用，改用 ' + (port + 1) + ' …');
      tryListen(port + 1);
    } else {
      console.error('启动失败：' + err.message);
      process.exitCode = 1;
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port;
    console.log('');
    console.log('  CSPD demo 已启动');
    console.log('  浏览器即将自动打开：' + url);
    console.log('  如果没有自动打开，请手动复制上面的地址到浏览器。');
    console.log('  使用期间请保持本窗口打开；关闭窗口即停止 demo。');
    console.log('');
    openBrowser(url);
  });
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error('');
  console.error('  找不到 demo 页面文件（' + path.relative(process.cwd(), ROOT) + '）。');
  console.error('  请确认下载的压缩包已完整解压，且本脚本位于项目根目录。');
  console.error('');
  process.exit(1);
}

tryListen(PORT_START);
