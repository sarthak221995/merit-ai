# --- Stage 1: Build the React App ---
FROM node:18-alpine as build

WORKDIR /app

# 1. Install Dependencies
# Copy package.json and lock file first to leverage Docker cache
COPY package.json package-lock.json ./

# CHANGE: Use 'npm install' instead of 'npm ci'
# 'npm ci' fails if package-lock.json is missing or out of sync.
# 'npm install' will fix the lockfile automatically.
RUN npm install

# 2. Copy Source Code
COPY . .

# 3. Build Arguments & Environment Variables
ARG REACT_APP_API_URL
ARG REACT_APP_CLERK_PUBLISHABLE_KEY
ARG REACT_APP_SUPABASE_URL
ARG REACT_APP_SUPABASE_ANON_KEY

ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_CLERK_PUBLISHABLE_KEY=$REACT_APP_CLERK_PUBLISHABLE_KEY
ENV REACT_APP_SUPABASE_URL=$REACT_APP_SUPABASE_URL
ENV REACT_APP_SUPABASE_ANON_KEY=$REACT_APP_SUPABASE_ANON_KEY

# 4. Create Production Build
RUN npm run build

# --- Stage 2: Serve with Nginx ---
FROM nginx:alpine

# 1. Copy the React build output from Stage 1 to Nginx's html folder
COPY --from=build /app/build /usr/share/nginx/html

# 2. Copy our custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 3. Expose Port 80
EXPOSE 80

# 4. Start Nginx
CMD ["nginx", "-g", "daemon off;"]