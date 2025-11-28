# FIX 1: Updated to 3.12 to match your pyproject.toml requirement (>=3.12)
FROM python:3.12-slim

WORKDIR /app

# 1. Install System Dependencies
# FIX 2: Added 'poppler-utils' which is REQUIRED for pdf2image
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    python3-cffi \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# 3. Copy Project Definition
COPY pyproject.toml uv.lock ./

# 4. Sync Dependencies
# --frozen: Use lockfile strictly
# --no-dev: No dev dependencies
# --no-install-project: Don't install the app package itself yet (caching)
RUN uv sync --frozen --no-dev --no-install-project

# 5. Copy Application Code
COPY . .

# 6. Final Sync
# This installs the project itself and ensures .venv is fully ready
RUN uv sync --frozen --no-dev

# 7. Expose Port
EXPOSE 8000

# 8. Run Command using 'uv run'
# FIX 3: Point to 'src.main:app' instead of 'main:app' because your code is in the src folder
CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]