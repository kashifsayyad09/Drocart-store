# ============================================================
#  DROCART BACKEND — Standalone API Container
#  Pure Flask + Gunicorn + eventlet, no static/template files
# ============================================================
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y default-libmysqlclient-dev gcc pkg-config curl && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD curl -f http://localhost:5000/health || exit 1
CMD ["gunicorn","--worker-class","eventlet","-w","1","--bind","0.0.0.0:5000","--timeout","120","app:app"]
