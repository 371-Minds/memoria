# Memoria Agent Integration Guide

This document provides instructions for AI agents, autonomous systems, and external services on how to interact with the Memoria API.

## Base URL
All API requests should be made to the base URL where the Memoria service is deployed.

## Authentication
Memoria uses Bearer token authentication. 
Include the following header in all protected requests:
`Authorization: Bearer <YOUR_API_KEY>`

The API supports multi-tenant keys. Ensure your assigned key is included in the `MEMORIA_API_KEYS` environment variable on the server (comma-separated).

## Endpoints

### 1. Health Check
Check if the Memoria service is online and ready to accept requests.
- **Endpoint:** `GET /api/health`
- **Auth Required:** No
- **Response:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-03-11T22:46:14.000Z",
    "service": "memoria"
  }
  ```

### 2. Store Memory
Save a new fact or memory for a specific user.
- **Endpoint:** `POST /api/memory/[userId]`
- **Auth Required:** Yes
- **Rate Limit:** 50 requests / minute
- **Body:**
  ```json
  {
    "text": "The user prefers dark mode."
  }
  ```

### 3. Retrieve Context
Perform a semantic search to recall facts relevant to a query.
- **Endpoint:** `GET /api/memory/[userId]/context?query=[your_query]&topK=3`
- **Auth Required:** Yes
- **Rate Limit:** 50 requests / minute
- **Query Parameters:**
  - `query` (required): The search string.
  - `topK` (optional): Number of results to return (default: 3).

### 4. List Memories
Retrieve all stored memories for a specific user, ordered by creation date (newest first).
- **Endpoint:** `GET /api/memory/[userId]`
- **Auth Required:** Yes
- **Rate Limit:** 100 requests / minute

### 5. Forget Memory
Delete a specific memory by its ID.
- **Endpoint:** `DELETE /api/memory/[userId]/[memoryId]`
- **Auth Required:** Yes
- **Rate Limit:** 100 requests / minute

### 6. GitMind Freeze (Encapsulate)
Compute the SHA-256 Merkle root of the agent's current memory state. This provides cryptographic provenance without requiring an external blockchain.
- **Endpoint:** `POST /api/memory/[userId]/encapsulate`
- **Auth Required:** Yes
- **Rate Limit:** 10 requests / minute
- **Response:**
  ```json
  {
    "success": true,
    "txId": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "arweaveUrl": "git://local/user_123/commit/...",
    "bootloader": "data:text/html;base64,..."
  }
  ```

## Rate Limiting
The API enforces rate limits per user ID. If limits are exceeded, the API returns a `429 Too Many Requests` status with the following headers:
- `X-RateLimit-Limit`: The maximum number of requests allowed in the current window.
- `X-RateLimit-Remaining`: The number of requests remaining in the current window.
- `X-RateLimit-Reset`: Unix timestamp (in milliseconds) when the rate limit window resets.
