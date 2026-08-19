FROM node:20-alpine

# Install git for dynamic repository pulling, ca-certificates, and curl
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

# Create persistent data directory and repo directory
RUN mkdir -p /app/repo /data

# Copy entrypoint script
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Copy existing files as fallback/base
COPY . /app/repo/

# Default environment variables
ENV PORT=3000 \
    DATA_DIR=/data \
    NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
