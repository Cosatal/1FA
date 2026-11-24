# 1FA in a container: docker compose up -d (see README, "Hosting with Docker")
FROM node:22-bookworm-slim

# Fonts for the images the bot draws (welcome card, /rank, captcha): the slim image has none
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src

# Saved data in a volume, owned by the unprivileged user that runs the bot
ENV NODE_ENV=production DATA_DIR=/data
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000
# The settings come from the environment (docker compose: env_file), not from a .env file inside the image
CMD ["node", "src/index.js"]
