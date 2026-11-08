# How Railway builds and runs the server.
#
# Railway's default builder downloads a helper from GitHub before every
# build, so a GitHub outage stops deploys. This recipe only needs Node's
# official image (from Docker Hub) and npm, so it keeps working when GitHub
# is slow.

FROM node:22-bookworm-slim

WORKDIR /app

# Install packages first, so a change to the code alone doesn't redo this step.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

# Then the code, the pictures and fonts, and the farm app; build; and drop the
# tools only needed for building.
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
CMD ["npm", "start"]
