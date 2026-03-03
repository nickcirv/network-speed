#!/usr/bin/env node
/**
 * network-speed — Test download/upload speed and latency from the terminal.
 * Zero external dependencies. Built-in modules only.
 */

import https from 'https';
import http from 'http';
import net from 'net';
import { URL } from 'url';
import crypto from 'crypto';
import os from 'os';

const VERSION = '1.0.0';

// ─── ANSI helpers ─────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  red:     '\x1b[31m',
};
const clr  = (color, str) => isTTY ? `${C[color]}${str}${C.reset}` : str;
const bold = (str)        => isTTY ? `${C.bold}${str}${C.reset}` : str;
const dim  = (str)        => isTTY ? `${C.dim}${str}${C.reset}` : str;

// ─── Argument parsing ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    download: false,
    upload:   false,
    ping:     false,
    full:     false,
    json:     false,
    simple:   false,
    isp:      false,
    server:   null,
    size:     10,
    duration: 10,
    help:     false,
    version:  false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--download': opts.download = true; break;
      case '--upload':   opts.upload   = true; break;
      case '--ping':     opts.ping     = true; break;
      case '--json':     opts.json     = true; break;
      case '--simple':   opts.simple   = true; break;
      case '--isp':      opts.isp      = true; break;
      case '--help':
      case '-h':         opts.help     = true; break;
      case '--version':
      case '-v':         opts.version  = true; break;
      case '--server':
        opts.server = args[++i];
        break;
      case '--size':
        opts.size = Math.max(1, parseInt(args[++i], 10) || 10);
        break;
      case '--duration':
        opts.duration = Math.max(1, parseInt(args[++i], 10) || 10);
        break;
      default:
        process.stderr.write(`Unknown option: ${args[i]}\n`);
    }
  }

  if (!opts.download && !opts.upload && !opts.ping) opts.full = true;
  return opts;
}

// ─── Help ─────────────────────────────────────────────────────────────────────
function printHelp() {
  process.stdout.write(`
${bold('network-speed')} v${VERSION} — Test network speed from the terminal

${bold('USAGE')}
  network-speed [options]

${bold('MODES')}
  (no flags)            Full test: ping + download + upload
  --ping                Latency test only
  --download            Download speed only
  --upload              Upload speed only

${bold('OPTIONS')}
  --server <url>        Custom test server base URL
  --size <mb>           Download test size in MB (default: 10)
  --duration <s>        Upload test duration in seconds (default: 10)
  --isp                 Show ISP info (uses http to ip-api.com)
  --json                Output results as JSON
  --simple              One-line summary output
  --version, -v         Show version
  --help, -h            Show this help

${bold('EXAMPLES')}
  network-speed
  network-speed --ping
  network-speed --download --size 50
  network-speed --upload --duration 15
  network-speed --json
  network-speed --simple
  network-speed --isp
`);
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
let lastLineLength = 0;

function drawProgress(label, speedMbps, bytesTotal, elapsed, totalBytes) {
  if (!isTTY) return;
  const BAR_WIDTH = 26;
  const fraction  = totalBytes > 0 ? Math.min(bytesTotal / totalBytes, 1) : 0;
  const filled    = Math.round(BAR_WIDTH * fraction);
  const bar       = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const pct       = totalBytes > 0 ? `${Math.round(fraction * 100)}%` : '  ?%';
  const speedStr  = speedMbps >= 0 ? `${speedMbps.toFixed(1)} Mbps` : '--- Mbps';
  const line = `  ${clr('cyan', label)} [${clr('green', bar)}] ${pct.padStart(4)} ${bold(speedStr.padStart(11))}  ${dim(elapsed.toFixed(1) + 's')}`;
  process.stdout.write('\r' + ' '.repeat(lastLineLength) + '\r');
  process.stdout.write(line);
  lastLineLength = line.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function clearProgress() {
  if (!isTTY) return;
  process.stdout.write('\r' + ' '.repeat(lastLineLength) + '\r');
  lastLineLength = 0;
}

// ─── HTTP request helper ──────────────────────────────────────────────────────
function makeRequest(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const mod    = parsed.protocol === 'https:' ? https : http;
    const req    = mod.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    }, resolve);
    req.on('error', reject);
    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => req.destroy(new Error('Request timed out')));
    }
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── TCP ping ─────────────────────────────────────────────────────────────────
function tcpPing(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const t0   = process.hrtime.bigint();
    const sock = net.createConnection({ host, port }, () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      sock.destroy();
      resolve(ms);
    });
    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => { sock.destroy(); resolve(null); });
    sock.on('error',   () => resolve(null));
  });
}

// ─── PING test ────────────────────────────────────────────────────────────────
const PING_TARGETS = [
  { host: 'one.one.one.one', port: 443, label: '1.1.1.1'    },
  { host: 'cloudflare.com',  port: 443, label: 'Cloudflare' },
  { host: 'google.com',      port: 443, label: 'Google'     },
];

async function runPingTest(opts) {
  if (!opts.simple && !opts.json) {
    process.stdout.write(`\n${bold('Ping Test')}\n`);
  }

  const results = [];

  for (const target of PING_TARGETS) {
    const samples  = [];
    for (let i = 0; i < 5; i++) {
      const ms = await tcpPing(target.host, target.port);
      if (ms !== null) samples.push(ms);
      await sleep(80);
    }

    if (samples.length > 0) {
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      results.push({ host: target.host, label: target.label, min, avg, max });
      if (!opts.simple && !opts.json) {
        process.stdout.write(
          `  ${clr('blue', target.label.padEnd(12))} ` +
          `min ${clr('green', min.toFixed(1) + 'ms')}  ` +
          `avg ${bold(avg.toFixed(1) + 'ms')}  ` +
          `max ${clr('yellow', max.toFixed(1) + 'ms')}\n`
        );
      }
    } else {
      results.push({ host: target.host, label: target.label, error: 'unreachable' });
      if (!opts.simple && !opts.json) {
        process.stdout.write(`  ${clr('blue', target.label.padEnd(12))} ${clr('red', 'unreachable')}\n`);
      }
    }
  }

  const reachable = results.filter(r => !r.error);
  const bestMs    = reachable.length > 0
    ? Math.min(...reachable.map(r => r.avg))
    : null;

  return { targets: results, bestMs };
}

// ─── DOWNLOAD test ────────────────────────────────────────────────────────────
function downloadUrl(bytes, server) {
  if (server) return `${server.replace(/\/$/, '')}/__down?bytes=${bytes}`;
  return `https://speed.cloudflare.com/__down?bytes=${bytes}`;
}

async function fetchAndMeasure(url, expectedBytes, label, opts) {
  const t0        = process.hrtime.bigint();
  let totalBytes  = 0;
  let lastBytes   = 0;
  let lastTime    = t0;
  let serverInfo  = null;
  let currentSpeed = 0;

  const res = await makeRequest(url, { timeoutMs: 90000 });

  if (res.headers['cf-ray'])   serverInfo = 'Cloudflare';
  else if (res.headers['server']) serverInfo = res.headers['server'];

  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      totalBytes += chunk.length;
      const now  = process.hrtime.bigint();
      const dtMs = Number(now - lastTime) / 1e6;
      if (dtMs >= 300) {
        currentSpeed = ((totalBytes - lastBytes) * 8) / (dtMs / 1000) / 1e6;
        lastBytes    = totalBytes;
        lastTime     = now;
        drawProgress(label, currentSpeed, totalBytes, Number(now - t0) / 1e9, expectedBytes);
      }
    });
    res.on('end',   resolve);
    res.on('error', reject);
  });

  clearProgress();
  return { totalBytes, elapsed: Number(process.hrtime.bigint() - t0) / 1e9, serverInfo };
}

async function runDownloadTest(opts) {
  const bytes = opts.size * 1024 * 1024;
  const url   = downloadUrl(bytes, opts.server);
  const host  = new URL(url).hostname;

  if (!opts.simple && !opts.json) {
    process.stdout.write(`\n${bold('Download Test')}  ${dim(`(${opts.size} MB from ${host})`)}\n`);
  }

  let totalBytes, elapsed, serverInfo;

  try {
    ({ totalBytes, elapsed, serverInfo } = await fetchAndMeasure(url, bytes, '↓ Download', opts));
  } catch {
    // Fallback: httpbin
    try {
      const fallback = `https://httpbin.org/bytes/${Math.min(bytes, 10 * 1024 * 1024)}`;
      if (!opts.simple && !opts.json) {
        process.stdout.write(dim(`  (primary failed, trying httpbin fallback)\n`));
      }
      ({ totalBytes, elapsed, serverInfo } = await fetchAndMeasure(fallback, bytes, '↓ Download', opts));
    } catch (e2) {
      throw new Error(`Download test failed: ${e2.message}`);
    }
  }

  const mbps = (totalBytes * 8) / elapsed / 1e6;
  const MBps = totalBytes / elapsed / 1e6;

  if (!opts.simple && !opts.json) {
    printSpeedLine('Download', mbps, MBps, serverInfo);
  }

  return { mbps, MBps, bytes: totalBytes, durationSec: elapsed, server: serverInfo };
}

// ─── UPLOAD test ─────────────────────────────────────────────────────────────
const CHUNK_SIZE = 256 * 1024; // 256 KB

function uploadUrl(server) {
  if (server) return `${server.replace(/\/$/, '')}/post`;
  return 'https://httpbin.org/post';
}

async function runUploadTest(opts) {
  const durationMs  = opts.duration * 1000;
  const url         = uploadUrl(opts.server);
  const parsedUrl   = new URL(url);
  const mod         = parsedUrl.protocol === 'https:' ? https : http;

  if (!opts.simple && !opts.json) {
    process.stdout.write(`\n${bold('Upload Test')}  ${dim(`(${opts.duration}s to ${parsedUrl.hostname})`)}\n`);
  }

  const t0          = process.hrtime.bigint();
  let totalBytes    = 0;
  let lastBytes     = 0;
  let lastTime      = t0;
  let currentSpeed  = 0;
  let estTotal      = opts.duration * 5 * 1024 * 1024;
  const deadline    = Date.now() + durationMs;

  while (Date.now() < deadline) {
    const remaining  = deadline - Date.now();
    const chunkBytes = Math.min(CHUNK_SIZE, Math.max(1024, remaining * 512));
    const chunk      = crypto.randomBytes(chunkBytes);

    try {
      await new Promise((resolve, reject) => {
        const req = mod.request({
          hostname: parsedUrl.hostname,
          port:     parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path:     parsedUrl.pathname + parsedUrl.search,
          method:   'POST',
          headers:  {
            'Content-Type':   'application/octet-stream',
            'Content-Length': chunk.length,
          },
        }, (res) => {
          res.resume();
          res.on('end',   resolve);
          res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(8000, () => req.destroy(new Error('timeout')));
        req.write(chunk);
        req.end();
      });

      totalBytes += chunk.length;
      const now = process.hrtime.bigint();
      currentSpeed = (totalBytes * 8) / (Number(now - t0) / 1e9) / 1e6;
      lastBytes    = totalBytes;
      lastTime     = now;
      estTotal     = Math.max(estTotal, totalBytes * 1.15);
      drawProgress('↑ Upload', currentSpeed, totalBytes, Number(now - t0) / 1e9, estTotal);
    } catch {
      // skip failed chunk
    }
  }

  clearProgress();
  const elapsed = Number(process.hrtime.bigint() - t0) / 1e9;

  if (totalBytes === 0) throw new Error('Upload test failed — no data sent successfully');

  const mbps = (totalBytes * 8) / elapsed / 1e6;
  const MBps = totalBytes / elapsed / 1e6;

  if (!opts.simple && !opts.json) {
    printSpeedLine('Upload', mbps, MBps, null);
  }

  return { mbps, MBps, bytes: totalBytes, durationSec: elapsed };
}

// ─── ISP lookup ───────────────────────────────────────────────────────────────
async function fetchISP() {
  return new Promise((resolve) => {
    const req = http.get(
      'http://ip-api.com/json/?fields=isp,org,city,country,query',
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve(null); }
        });
      }
    );
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

// ─── Display helpers ──────────────────────────────────────────────────────────
function speedRating(mbps) {
  if (mbps < 5)   return '🐢';
  if (mbps < 25)  return '🐇';
  if (mbps < 100) return '⚡';
  return '🚀';
}

function printSpeedLine(label, mbps, MBps, server) {
  const rating    = speedRating(mbps);
  const serverStr = server ? `  ${dim('(' + server + ')')}` : '';
  process.stdout.write(
    `  ${clr('cyan', label.padEnd(10))} ${bold((mbps.toFixed(1) + ' Mbps').padStart(12))}` +
    `  ${dim((MBps.toFixed(2) + ' MB/s').padStart(10))}  ${rating}${serverStr}\n`
  );
}

function printSummary(results) {
  process.stdout.write(`\n${bold('─'.repeat(56))}\n`);
  if (results.download) {
    printSpeedLine('Download', results.download.mbps, results.download.MBps, results.download.server);
  }
  if (results.upload) {
    printSpeedLine('Upload', results.upload.mbps, results.upload.MBps, null);
  }
  if (results.ping && results.ping.bestMs !== null) {
    const p = results.ping.bestMs;
    process.stdout.write(
      `  ${clr('cyan', 'Ping'.padEnd(10))} ${bold((p.toFixed(1) + ' ms').padStart(12))}` +
      `  ${dim('best of 3 servers')}\n`
    );
  }
  if (results.isp) {
    const isp = results.isp;
    process.stdout.write(
      `  ${clr('cyan', 'ISP'.padEnd(10))} ${isp.isp || isp.org || 'Unknown'}` +
      (isp.city ? `  ${dim(isp.city + ', ' + isp.country)}` : '') + '\n'
    );
    if (isp.query) {
      process.stdout.write(`  ${clr('cyan', 'IP'.padEnd(10))} ${dim(isp.query)}\n`);
    }
  }
  process.stdout.write(`${bold('─'.repeat(56))}\n\n`);
}

function printSimple(results) {
  const parts = [];
  if (results.download) parts.push(`↓ ${results.download.mbps.toFixed(1)} Mbps`);
  if (results.upload)   parts.push(`↑ ${results.upload.mbps.toFixed(1)} Mbps`);
  if (results.ping && results.ping.bestMs !== null) {
    parts.push(`🏓 ${results.ping.bestMs.toFixed(0)}ms`);
  }
  process.stdout.write(parts.join('  ') + '\n');
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.version) {
    process.stdout.write(`network-speed v${VERSION}\n`);
    process.exit(0);
  }

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (!opts.simple && !opts.json) {
    process.stdout.write(
      `\n${bold(clr('cyan', 'network-speed'))} ${dim('v' + VERSION)}` +
      `  ${dim('node ' + process.version)}  ${dim(os.platform() + '/' + os.arch())}\n`
    );
  }

  const results = {};
  let ispPromise = null;
  if (opts.isp) ispPromise = fetchISP();

  try {
    if (opts.full || opts.ping)     results.ping     = await runPingTest(opts);
    if (opts.full || opts.download) results.download = await runDownloadTest(opts);
    if (opts.full || opts.upload)   results.upload   = await runUploadTest(opts);
    if (ispPromise)                  results.isp      = await ispPromise;
  } catch (err) {
    clearProgress();
    process.stderr.write(`\n${clr('red', 'Error:')} ${err.message}\n`);
    process.exit(1);
  }

  if (opts.json) {
    const out = {
      version:     VERSION,
      timestamp:   new Date().toISOString(),
      platform:    os.platform(),
      arch:        os.arch(),
      nodeVersion: process.version,
    };
    if (results.ping) {
      out.ping = {
        bestMs:  results.ping.bestMs,
        targets: results.ping.targets.map(t => ({
          label: t.label,
          host:  t.host,
          ...(t.error
            ? { error: t.error }
            : { minMs: +t.min.toFixed(2), avgMs: +t.avg.toFixed(2), maxMs: +t.max.toFixed(2) }),
        })),
      };
    }
    if (results.download) {
      out.download = {
        mbps:        +results.download.mbps.toFixed(2),
        MBps:        +results.download.MBps.toFixed(2),
        bytes:       results.download.bytes,
        durationSec: +results.download.durationSec.toFixed(2),
        server:      results.download.server,
        rating:      speedRating(results.download.mbps),
      };
    }
    if (results.upload) {
      out.upload = {
        mbps:        +results.upload.mbps.toFixed(2),
        MBps:        +results.upload.MBps.toFixed(2),
        bytes:       results.upload.bytes,
        durationSec: +results.upload.durationSec.toFixed(2),
        rating:      speedRating(results.upload.mbps),
      };
    }
    if (results.isp) out.isp = results.isp;
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }

  if (opts.simple) {
    printSimple(results);
    return;
  }

  printSummary(results);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
