FROM node:24-alpine
WORKDIR /app
COPY package.json lib.js web.js prof.js server.js ./
COPY public ./public
COPY decks/questions-courtes.md ./decks/questions-courtes.md
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
