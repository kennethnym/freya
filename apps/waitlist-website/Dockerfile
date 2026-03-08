FROM oven/bun:1 AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN bun install

FROM oven/bun:1 AS production-dependencies-env
COPY ./package.json /app/
WORKDIR /app
RUN bun install --production

FROM oven/bun:1 AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN bun run build

FROM node:20-alpine
COPY ./package.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
CMD ["npm", "run", "start"]