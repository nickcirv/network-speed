<div align="center">

# network-speed

**Test download speed, upload speed, and latency from the terminal — no npm packages required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?labelColor=0B0A09)](LICENSE)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?labelColor=0B0A09)](package.json)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-blue?labelColor=0B0A09)](package.json)

</div>

## Install

```bash
npx github:NickCirv/network-speed
```

Or run without a persistent install:

```bash
node --input-type=module < <(curl -fsSL https://raw.githubusercontent.com/NickCirv/network-speed/main/index.js)
```

## Usage

```bash
# Full test: ping + download + upload
npx github:NickCirv/network-speed

# Individual modes
npx github:NickCirv/network-speed --ping
npx github:NickCirv/network-speed --download --size 50
npx github:NickCirv/network-speed --upload --duration 20

# Machine-readable / scripting
npx github:NickCirv/network-speed --json
npx github:NickCirv/network-speed --simple   # one line: ↓ 102.4 Mbps ↑ 12.1 Mbps 🏓 22ms
```

| Flag | Default | Description |
|------|---------|-------------|
| `--ping` | — | Latency test only (TCP SYN→SYN-ACK, 3 targets) |
| `--download` | — | Download speed only |
| `--upload` | — | Upload speed only |
| `--size <mb>` | `10` | Download file size in MB |
| `--duration <s>` | `10` | Upload test duration in seconds |
| `--server <url>` | Cloudflare / httpbin | Custom test server |
| `--isp` | off | Show ISP, city, country, and public IP |
| `--json` | off | Emit results as JSON |
| `--simple` | off | One-line summary |

## What it does

Measures download throughput by fetching bytes from `speed.cloudflare.com`, upload throughput by POSTing random bytes to `httpbin.org`, and latency via TCP connect time (SYN→SYN-ACK) to 1.1.1.1, Cloudflare, and Google — 5 samples per target. ISP lookup is optional via `ip-api.com`. All network I/O uses Node's built-in `https`, `http`, and `net` modules — no third-party packages, no global install needed.

---
<sub>Zero dependencies · Node >=18 · MIT · by <a href="https://github.com/NickCirv">NickCirv</a></sub>
