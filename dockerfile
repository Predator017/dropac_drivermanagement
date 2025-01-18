FROM node:lts-alpine
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "start"]
EXPOSE 3030


# Stage 1: Dependencies
# FROM node:lts-alpine as dependencies
# WORKDIR /app
# COPY package*.json ./
# RUN npm install
# COPY . .

# # Stage 2: Runtime
# FROM node:lts-alpine
# WORKDIR /app
# COPY --from=dependencies /app/node_modules ./node_modules
# COPY --from=dependencies /app .
# EXPOSE 3030
# CMD ["npm", "start"]
