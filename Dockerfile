# Dockerfile for building rx-viewer frontend
# Uses official Bun image to build the frontend without installing Bun system-wide

FROM oven/bun:1

WORKDIR /app

# Increase memory limit for large builds (Monaco Editor is big)
ENV NODE_OPTIONS="--max-old-space-size=8192"

# Copy package files first for better caching
COPY package.json bun.lock* ./

# Install dependencies (allow lockfile updates for new packages)
RUN bun install

# Copy source files
COPY . .

# Build the frontend and copy to output volume
CMD ["sh", "-c", "bun run build && cp -r dist/* /output/"]
