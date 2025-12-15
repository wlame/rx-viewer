#!/bin/bash
set -e

echo "============================================"
echo "  RX Viewer - Build Script"
echo "============================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

# Check if bun is installed
if ! command -v bun &> /dev/null; then
    echo -e "${RED}Error: Bun is not installed${NC}"
    echo "Install Bun: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

echo -e "${BLUE}[1/3] Installing Dependencies...${NC}"
echo "--------------------------------------"
bun install

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Dependency installation failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

echo -e "${BLUE}[2/3] Building Frontend...${NC}"
echo "--------------------------------------"
bun run build

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Frontend built successfully${NC}"
echo ""

echo -e "${BLUE}[3/3] Creating Distribution Archive...${NC}"
echo "--------------------------------------"

# Get version from package.json
VERSION=$(cat package.json | grep '"version"' | head -1 | sed 's/.*: "\(.*\)".*/\1/')
echo "Version: $VERSION"

# Get git commit (if available)
if command -v git &> /dev/null && git rev-parse --git-dir > /dev/null 2>&1; then
    COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
else
    COMMIT="unknown"
fi

# Create version.json in dist
cat > dist/version.json << EOF
{
  "version": "$VERSION",
  "buildDate": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "commit": "$COMMIT"
}
EOF

echo "Created dist/version.json"

# Create tarball
tar -czf dist.tar.gz -C dist .

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Archive creation failed${NC}"
    exit 1
fi

# Get archive size
ARCHIVE_SIZE=$(du -sh dist.tar.gz | cut -f1)
FILE_COUNT=$(find dist -type f | wc -l | tr -d ' ')

echo "Archive created: dist.tar.gz"
echo "  - Size: $ARCHIVE_SIZE"
echo "  - Files: $FILE_COUNT"
echo "  - Version: $VERSION"
echo "  - Commit: $COMMIT"

echo -e "${GREEN}✓ Distribution archive ready${NC}"
echo ""

echo "============================================"
echo -e "${GREEN}  Build Complete! ✓${NC}"
echo "============================================"
echo ""
echo "Output files:"
echo "  - dist/           - Built frontend"
echo "  - dist.tar.gz     - Distribution archive"
echo ""
echo "To test locally:"
echo "  1. Extract: mkdir -p ~/.cache/rx/frontend && tar -xzf dist.tar.gz -C ~/.cache/rx/frontend"
echo "  2. Run backend: rx serve"
echo "  3. Open: http://localhost:8000"
echo ""
