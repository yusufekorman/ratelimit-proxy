# Rate Limit Proxy

This project is a high-performance rate limit proxy based on Redis. It protects your APIs by limiting requests.

## Features

- **Redis + In-Memory Fallback**: Automatically switches to in-memory if Redis is down.
- **HMAC Security**: Validates requests with HMAC signatures (protection against replay attacks).
- **Performance Optimization**: Atomic rate limiting with Lua scripts.
- **Joi Validation**: Uses Joi for request validation.
- **Health Check**: `/health` endpoint for status monitoring.

## Requirements

- Node.js (or Bun runtime)
- Redis (optional, in-memory fallback available)
- Docker (optional)

## Installation

### Local Installation

1. Install dependencies:

   ```bash
   bun install
   ```

   or if using npm:

   ```bash
   npm install
   ```

2. Set environment variables:

   ```bash
   export REDIS_URL=redis://localhost:6379
   export RL_SECRET=your-secret-key-here
   ```

   - `REDIS_URL`: Redis connection URL (default: in-memory mode).
   - `RL_SECRET`: Shared secret key for HMAC signatures (choose a strong key).

3. Run the application:

   ```bash
   bun run index.ts
   ```

   The application will run on `http://localhost:3001`.

### Docker Installation

1. Build the Docker image:

   ```bash
   docker build -t ratelimit-proxy .
   ```

2. Run it:

   ```bash
   docker run -p 3001:3001 -e REDIS_URL=redis://host.docker.internal:6379 -e RL_SECRET=your-secret-key-here ratelimit-proxy
   ```

   If using Redis inside Docker, adjust the `REDIS_URL` accordingly.

## Usage

### Authentication

All requests must include the following headers:

- `Authorization: Bearer <RL_SECRET>`
- `X-Timestamp: <current_unix_timestamp_in_ms>` (as string)
- `X-Signature: <hmac_sha256_signature>`

Signature calculation: `HMAC-SHA256(RL_SECRET, timestamp.toString())` and encode the result as hex or base64 (the code uses hex)

Example (JavaScript):

```javascript
const crypto = require("crypto");

const secret = "your-secret-key";
const timestamp = Date.now();

const signature = crypto
  .createHmac("sha256", secret)
  .update(timestamp.toString())
  .digest("hex");
```

### Rate Limit Check

**Endpoint:** `POST /ratelimit`

**Request Body:**

```json
{
  "key": "user123",
  "points": 100,
  "duration": 60
}
```

**Parameters:**

- `key` (string, required): Rate limit key (e.g., user ID).
- `points` (number, optional): Maximum number of requests (default: 100).
- `duration` (number, optional): Duration in seconds (default: 60, i.e., 1 minute).

**Successful Response:**

```json
{
  "allowed": true,
  "remaining": 99
}
```

**Rejected Response (Rate Limit Exceeded):**

```json
{
  "allowed": false,
  "retryAfter": 45
}
```

### Health Check

**Endpoint:** `GET /health`

**Response:**

```json
{
  "status": "ok",
  "redis": "connected",
  "memoryStoreSize": 0
}
```

- `redis`: Redis connection status ("connected" or "disconnected (using memory fallback)").
- `memoryStoreSize`: Number of active keys in memory store.

## Examples

### Rate Limit Check with cURL

```bash
# Calculate signature first (example values)
TIMESTAMP=$(date +%s%3N)
SIGNATURE=$(echo -n "$TIMESTAMP" | openssl dgst -sha256 -hmac "your-secret-key" | cut -d' ' -f2)

curl -X POST http://localhost:3001/ratelimit \
  -H "Authorization: Bearer your-secret-key" \
  -H "X-Timestamp: $TIMESTAMP" \
  -H "X-Signature: $SIGNATURE" \
  -H "Content-Type: application/json" \
  -d '{"key": "test-user", "points": 5, "duration": 10}'
```

### Testing with Postman

1. Create a new POST request: `http://localhost:3001/ratelimit`
2. In the Headers tab, add:
   - Key: `Authorization`, Value: `Bearer your-secret-key`
   - Key: `X-Timestamp`, Value: `{{timestamp}}` (set via Pre-request script)
   - Key: `X-Signature`, Value: `{{signature}}`
3. In the Body tab, add JSON:

   ```json
   {
     "key": "user123",
     "points": 10,
     "duration": 60
   }
   ```

4. Pre-request Script (JavaScript):

   ```javascript
   const timestamp = Date.now();
   const secret = "your-secret-key";

   const crypto = require("crypto-js");
   const signature = crypto.HmacSHA256(timestamp.toString(), secret).toString();

   pm.globals.set("timestamp", timestamp);
   pm.globals.set("signature", signature);
   ```

## Configuration

### Environment Variables

- `REDIS_URL`: Redis connection URL (e.g., `redis://localhost:6379`). If not set, uses in-memory mode.
- `RL_SECRET`: Secret key for HMAC. Required.
- `PORT`: Server port (default: 3001, hardcoded in code).

### Security Notes

- Keep `RL_SECRET` strong and secret.
- Requests expire within 30 seconds (clock skew protection).

## Troubleshooting

### Redis Connection Issues

- If Redis is down? The app automatically falls back to memory mode.
- Check logs for connection errors.

### Authentication Errors

- "Unauthorized": Incorrect `Authorization` header.
- "Missing signature": Missing `X-Timestamp` or `X-Signature`.
- "Expired request": Request older than 30 seconds.
- "Invalid signature": Incorrectly calculated signature. Check timestamp.

### Rate Limiting Not Working

- Check the `/health` endpoint.
- Verify Redis connection.
- Review logs.

### Docker Issues

- Port conflict: Use a different port (`-p 3002:3001`).
- Redis connection: Check Docker network.

## Development

- Written in TypeScript.
- Uses Fastify framework.
- Test with: `curl`, Postman, or any HTTP client.

### Source Code

Main file: `index.ts`

### Dependencies

- `fastify`: Web framework.
- `ioredis`: Redis client.
- `joi`: Validation.

## Contributing

1. Fork the repo.
2. Create a feature branch.
3. Commit your changes.
4. Submit a pull request.

## License

Open to Everyone.
