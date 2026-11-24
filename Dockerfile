# Step 1: Build the React application
FROM node:20-alpine AS build

WORKDIR /app

# Copy dependency specifications and install cleanly
COPY package*.json ./
RUN npm ci

# Copy the remaining project files and build static bundle
COPY . .
RUN npm run build

# Step 2: Serve production assets using Nginx
FROM nginx:alpine

# Default port for Google Cloud Run is 8080
ENV PORT=8080

# Copy Nginx template; official nginx images run envsubst on files in templates/ automatically
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Copy compiled static assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
