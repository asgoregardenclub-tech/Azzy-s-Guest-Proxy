#!/bin/bash
echo "=== Starting Gemini JanitorAI Guest Proxy ==="

if ! command -v node &> /dev/null
then
    echo "[ERROR] Node.js could not be found."
    echo "On Linux: sudo apt install nodejs npm"
    echo "On Termux: pkg install nodejs"
    exit 1
fi

if [ ! -d "node_modules" ]; then
    echo "Installing required dependencies..."
    npm install
fi

npm start
