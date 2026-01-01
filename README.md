# Rate Limit Proxy

This project is a high-performance rate limit proxy based on Redis. It protects your APIs by limiting requests.

## Features

- **Redis + In-Memory Fallback**: Automatically switches to in-memory if Redis is down.
- **HMAC Security**: Validates requests with HMAC signatures (protection against replay attacks).
- **IP Detection**: Supports Cloudflare, X-Forwarded-For, etc. headers.
- **Performance Optimization**: Atomic rate limiting with Lua scripts.
- **Joi Validation**: Uses Joi for request validation.
- **Health Check**: `/health` endpoint for status monitoring.

## Installation

1. Install dependencies:

   ```bash
   bun install
   ```

2. Set environment variables:

   ```bash
   export REDIS_URL=redis://localhost:6379
   export RL_SECRET=your-secret-key
   ```

3. Run:
   ```bash
   bun run index.ts
   ```

## Usage

### Rate Limit Check

POST `/ratelimit`

Body:

```json
{
  "key": "user123",
  "points": 100,
  "duration": 60
}
```

Response:

```json
{
  "allowed": true,
  "remaining": 99
}
```

- `key`: Rate limit key (e.g., user ID).
- `points`: Maximum number of requests (default: 100).
- `duration`: Duration in seconds (default: 60, i.e., 1 minute).

### Health Check

GET `/health`

Response:

```json
{
  "status": "ok",
  "redis": "connected",
  "memoryStoreSize": 0
}
```

## Security

- Authorization with Bearer token.
- HMAC signature verification (IP + timestamp).
- Clock skew protection (maximum 30 seconds).

## Development

- Written in TypeScript.
- Uses Fastify framework.
- Test with: `curl` or Postman.

## License

Open to Everyone.
