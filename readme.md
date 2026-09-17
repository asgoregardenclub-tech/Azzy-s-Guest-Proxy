# 🎭 Gemini Guest Proxy for JanitorAI (Localhost)

A zero-config, keyless reverse proxy that bridges **JanitorAI** with Google Gemini by automatically cycling unauthenticated guest sessions. 

### ✨ Features
- **No API Keys Needed:** Operates entirely through Google Gemini's guest session tier.
- **Intelligent Account Cycling:** Maintains a pool of isolated guest workers that round-robin, auto-refresh on rate limits (429), and cycle every 20-25 requests.
- **Full OpenAI Spec Compatibility:** Exposes `/v1/chat/completions` and `/v1/models` with complete Server-Sent Events (SSE) streaming support.
- **Universal Multi-Platform:** Runs natively on **Windows**, **Linux**, **macOS**, and **Android (Termux)**.

---

## 🚀 Setup & Installation

### 💻 1. Windows
1. Download and install **[Node.js](https://nodejs.org/)** (v18 or higher).
2. Clone or download this repository.
3. Double-click **`start.bat`**.
4. The proxy will automatically install dependencies and start on `http://localhost:5000/v1`.

---

### 🐧 2. Linux / macOS
1. Open terminal and ensure Node.js is installed:
   ```bash
   node -v
   # If not installed on Ubuntu/Debian:
   sudo apt update && sudo apt install nodejs npm
