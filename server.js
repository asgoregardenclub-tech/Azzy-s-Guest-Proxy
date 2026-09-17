#!/bin/bash

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing project dependencies..."
npm install

if [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ]; then
    TARGET_BIN="$PREFIX/bin/Azzys"
elif [ -d "$HOME/.local/bin" ]; then
    TARGET_BIN="$HOME/.local/bin/Azzys"
else
    TARGET_BIN="/usr/local/bin/Azzys"
fi

echo "Registering 'Azzys' shortcut..."

cat << 'EOF' > "$TARGET_BIN"
#!/bin/sh
PROJECT_DIR="__REPLACE_DIR__"
cd "$PROJECT_DIR" || exit 1

# Check if user typed 'Azzys update'
if [ "$1" = "update" ]; then
    echo "🔄 Fetching latest updates from GitHub..."
    git pull
    npm install
    echo "✅ Successfully updated! Run 'Azzys' to start."
    exit 0
fi

# Otherwise, start the proxy
node server.js
EOF

# Inject real directory path into the script
sed -i "s|__REPLACE_DIR__|$PROJECT_DIR|g" "$TARGET_BIN"
chmod +x "$TARGET_BIN"

echo "Setup complete! Type 'Azzys' to run, or 'Azzys update' to update."
