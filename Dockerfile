# 一线决战（One Line Battle）— 前端 + PvP 服务器 一体化镜像
# 所有依赖均通过国内镜像源下载：
#   - npm: https://registry.npmmirror.com
#   - Alpine apk: https://mirrors.aliyun.com
# 构建示例：
#   docker build -t zizouqi .
#   docker run -d -p 3000:3000 --name zizouqi zizouqi

# ------------------------------------------------------------ 阶段 1：构建前端
FROM node:20-alpine AS web-build

# npm 国内镜像源（对 lockfile 中指向官方源的资源同样生效）
ENV npm_config_registry=https://registry.npmmirror.com \
    npm_config_disturl=https://npmmirror.com/mirrors/node \
    npm_config_fetch_retries=5

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ------------------------------------------------------------ 阶段 2：安装后端依赖
FROM node:20-alpine AS server-deps

ENV npm_config_registry=https://registry.npmmirror.com \
    npm_config_fetch_retries=5

WORKDIR /server
COPY server/package.json server/package-lock.json ./
# server/package-lock.json 的 resolved 地址已固定为国内镜像源
RUN npm ci --omit=dev --no-audit --no-fund

# ------------------------------------------------------------ 阶段 3：运行时
FROM node:20-alpine

# apk 换用阿里云镜像源（基础镜像自带 busybox，无需额外安装包时也能加速层缓存）
RUN sed -i 's#https://dl-cdn.alpinelinux.org#https://mirrors.aliyun.com#g' /etc/apk/repositories

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app
COPY --from=server-deps /server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/index.mjs server/rooms.mjs ./server/
COPY --from=web-build /app/dist ./dist

EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server/index.mjs"]
