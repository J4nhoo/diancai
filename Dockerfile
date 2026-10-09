# 家庭点菜 H5 —— 后端容器镜像（腾讯云 CloudBase 云托管等容器平台用）
#
# ⚠️ 构建上下文必须是【仓库根目录】，不是 server/。
# 因为前端 web/ 要一起打进镜像（本项目前端是纯静态、由 Node 托管，
# 代码里按 ../web 解析路径，所以镜像内必须保持 server/ 与 web/ 的兄弟目录关系）。

FROM node:20-slim

WORKDIR /app

# 先只拷依赖清单，利用镜像层缓存：改业务代码时不必重装依赖
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

# 后端 + 前端
COPY server/ ./server/
COPY web/ ./web/

WORKDIR /app/server

ENV NODE_ENV=production
# 平台若已注入 PORT，运行时会覆盖这个兜底值
ENV PORT=80
EXPOSE 80

# 启动时自动建表建种子（幂等），由环境变量 AUTO_INIT_DB=true 控制
CMD ["node", "src/server.js"]
