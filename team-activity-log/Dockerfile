# =========================
# Stage 1: Build frontend
# =========================
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

# Declare build arg
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Install frontend dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy frontend code and build
COPY frontend/ .
RUN npm run build   # creates 'dist' folder for Vite

# =========================
# Stage 2: Build backend
# =========================
FROM python:3-alpine

WORKDIR /app

# Install backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Copy built frontend into backend folder
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Expose FastAPI port
EXPOSE 8000

# Start FastAPI
CMD ["uvicorn", "src.app.main:app", "--host", "0.0.0.0", "--port", "8000"]

