FROM node:24-alpine
WORKDIR /app
COPY package.json lib.js web.js prof.js server.js ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
