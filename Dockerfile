# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm install --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# --- Stage 2: backend + serve built SPA single-origin ---
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=frontend /fe/dist ./frontend_dist
ENV FRONTEND_DIST=/app/frontend_dist PORT=5002
EXPOSE 5002
CMD ["uvicorn", "app.main:application", "--host", "0.0.0.0", "--port", "5002"]
