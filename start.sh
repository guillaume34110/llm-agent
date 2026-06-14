#!/usr/bin/env bash
set -e

BACKEND_PORT=3469
FRONTEND_PORT=3470
MONKEY_PORT=3471

# Kill existing processes on those ports
for PORT in $BACKEND_PORT $FRONTEND_PORT $MONKEY_PORT; do
  PIDS=$(lsof -ti tcp:$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Killing process(es) on port $PORT: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null || true
  fi
done

# Start PostgreSQL if not already running
docker compose up -d db 2>/dev/null || true

# Wait for DB
echo "Waiting for DB on port 5434..."
until docker compose exec db pg_isready -U progsoft -q 2>/dev/null; do sleep 1; done
echo "DB ready."

# Start backend
echo "Starting backend on :$BACKEND_PORT..."
npm run start:dev &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend on :$FRONTEND_PORT..."
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

# Start monkey agent
echo "Starting monkey on :$MONKEY_PORT..."
cd monkey && MONKEY_PORT=$MONKEY_PORT BACKEND_URL=http://localhost:$BACKEND_PORT uvicorn main:app --host 127.0.0.1 --port $MONKEY_PORT &
MONKEY_PID=$!
cd ..

echo ""
echo "  Backend  → http://localhost:$BACKEND_PORT"
echo "  Frontend → http://localhost:$FRONTEND_PORT"
echo "  Monkey   → http://localhost:$MONKEY_PORT"
echo ""
echo "Press Ctrl+C to stop all."

trap "kill $BACKEND_PID $FRONTEND_PID $MONKEY_PID 2>/dev/null; exit 0" INT TERM
wait
