FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY index.js ./
EXPOSE 2026
ENV PORT=2026
CMD ["node", "index.js"]
