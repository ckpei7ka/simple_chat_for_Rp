FROM node:18-alpine

WORKDIR /app

# Копируем package.json сначала для кэширования зависимостей
COPY server/package.json ./server/

WORKDIR /app/server

# Устанавливаем зависимости
RUN npm install --production

# Копируем остальные файлы сервера
COPY server/server.js ./

# Создаем необходимые папки
RUN mkdir -p uploads data

# Копируем файлы клиента
COPY client/ ../client/

EXPOSE 3000

CMD ["node", "server.js"]