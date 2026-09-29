FROM node:18
WORKDIR /app
COPY package.json ./
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm install --production
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["npm", "start"]
