FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /workspace/e2e

COPY e2e/package.json e2e/yarn.lock ./
RUN yarn install --frozen-lockfile

COPY e2e/meet/load ./meet/load
COPY frontend/src/apps/meet/utils/media/encodings.ts /workspace/frontend/src/apps/meet/utils/media/encodings.ts
COPY suite/meet/types/participantMedia.ts /workspace/suite/meet/types/participantMedia.ts

ENTRYPOINT ["node", "meet/load/run.mjs"]
