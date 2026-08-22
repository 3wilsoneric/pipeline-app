# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS dependencies

RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Next.js standalone tracing follows the web entry point and therefore omits
# dependencies used only by operational scripts. Build the exact transitive
# production closure those scripts need without carrying the full build tree.
RUN node <<'NODE'
const { cpSync, existsSync, mkdirSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const roots = ["@azure/identity", "@azure/storage-blob", "postgres"];
const packages = new Set();

function includePackage(name) {
  if (packages.has(name)) return;
  const source = join("/app/node_modules", name);
  const manifestPath = join(source, "package.json");
  if (!existsSync(manifestPath)) return;
  packages.add(name);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const dependency of Object.keys({
    ...(manifest.dependencies ?? {}),
    ...(manifest.optionalDependencies ?? {}),
  })) includePackage(dependency);
}

for (const root of roots) includePackage(root);
for (const name of packages) {
  const destination = join("/app/runtime-ops-node_modules", name);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join("/app/node_modules", name), destination, { recursive: true });
}
NODE

FROM node:22-alpine AS builder

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_ENTRA_TENANT_ID
ARG NEXT_PUBLIC_ENTRA_CLIENT_ID
ARG NEXT_PUBLIC_PIPELINE_API_SCOPE
ARG NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=true
ARG NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true
ARG PIPELINE_DEPLOYMENT_ID
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_ENTRA_TENANT_ID=${NEXT_PUBLIC_ENTRA_TENANT_ID} \
    NEXT_PUBLIC_ENTRA_CLIENT_ID=${NEXT_PUBLIC_ENTRA_CLIENT_ID} \
    NEXT_PUBLIC_PIPELINE_API_SCOPE=${NEXT_PUBLIC_PIPELINE_API_SCOPE} \
    NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=${NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED} \
    NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=${NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED} \
    PIPELINE_DEPLOYMENT_ID=${PIPELINE_DEPLOYMENT_ID}

RUN --mount=type=secret,id=next_server_actions_encryption_key,required=false \
    mounted_key="$(cat /run/secrets/next_server_actions_encryption_key 2>/dev/null || true)" \
    && build_key="${mounted_key:-${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}}" \
    && test -n "$build_key" \
    && NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$build_key" npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN apk add --no-cache postgresql16-client \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/database ./database
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=dependencies --chown=nextjs:nodejs /app/runtime-ops-node_modules ./node_modules

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
