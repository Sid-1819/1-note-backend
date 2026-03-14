FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Copy Prisma schema so postinstall (prisma generate) can run
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

RUN pnpm run build

EXPOSE 3000

CMD ["pnpm", "run", "start:prod"]
