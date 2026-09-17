#!/bin/bash

# Get current folder path
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing project dependencies..."
npm install

# Check if running inside Termux ($PREFIX exists)
if [ -n "$PREFIX" ] && [ -d "$PREFIX/bin" ]; then
    TARGET_BIN="$PREFIX/bin/Azzys"
elif [ -d "$HOME/.local/bin" ]; then
    TARGET_BIN="$HOME/.local/bin/Azzys"
else
    TARGET_BIN="/usr/local/bin/Azzys"
fi

echo "Registering 'Azzys' shortcut..."

# Create the executable launcher script
cat << EOF > "$TARGET_BIN"
#!/bin/sh
cd "$PROJECT_DIR" || exit 1
node server.js
EOF

chmod +x "$TARGET_BIN"

echo ""
echo "=================================================="
echo " Setup complete!"
echo " You can now close this, open Termux, and type:"
echo ""
echo "       Azzys"
echo ""
echo " to start the proxy anytime from any directory!"
echo "=================================================="
