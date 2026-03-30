# Memoria API Documentation

The Memoria API provides endpoints for managing long-term semantic memory for AI agents. It uses embeddings to store and retrieve contextually relevant information.

## Base URL
All API requests should be made to the base URL of your deployed application.
Example: `https://your-app-url.run.app/api`

## Authentication
All endpoints require authentication via a Bearer token in the `Authorization` header.
```http
Authorization: Bearer <YOUR_API_KEY>
```
*Note: The API key is configured in the application settings.*

---

## Endpoints

### 1. Store Memory
Stores a new memory for a specific user. The text is automatically embedded and saved to the vector database.

**Endpoint:** `POST /api/memory/:userId`

**Request Body:**
```json
{
  "text": "The user prefers to use Cognitive Load Theory principles when designing AI systems."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "id": "uuid-string",
  "message": "Memory stored successfully"
}
```

---

### 2. Retrieve All Memories
Retrieves all stored memories for a specific user.

**Endpoint:** `GET /api/memory/:userId`

**Response (200 OK):**
```json
{
  "memories": [
    {
      "id": "uuid-string",
      "text": "The user prefers to use Cognitive Load Theory principles when designing AI systems.",
      "createdAt": 1711065600000
    }
  ]
}
```

---

### 3. Retrieve Context (Semantic Search)
Searches the user's memory for facts relevant to a specific query using vector similarity search.

**Endpoint:** `GET /api/memory/:userId/context?query=<search_query>&topK=<number>`

**Query Parameters:**
- `query` (required): The search string.
- `topK` (optional): The number of results to return (default: 3).

**Response (200 OK):**
```json
{
  "context": [
    "The user prefers to use Cognitive Load Theory principles when designing AI systems."
  ],
  "results": [
    {
      "id": "uuid-string",
      "text": "The user prefers to use Cognitive Load Theory principles when designing AI systems.",
      "score": 0.92
    }
  ]
}
```

---

### 4. Edit Memory
Updates the text of an existing memory. The embedding is automatically regenerated.

**Endpoint:** `PUT /api/memory/:userId/:memoryId`

**Request Body:**
```json
{
  "text": "The user prefers to use Cognitive Load Theory and Miller's Law when designing AI systems."
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Memory updated successfully"
}
```

---

### 5. Forget Memory
Deletes a specific memory by its ID.

**Endpoint:** `DELETE /api/memory/:userId/:memoryId`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Memory deleted successfully"
}
```

---

### 6. Import Memories
Imports a batch of memories for a user. Maximum 100 memories per request.

**Endpoint:** `POST /api/memory/:userId/import`

**Request Body:**
```json
{
  "memories": [
    { "text": "Fact 1" },
    { "text": "Fact 2" }
  ]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "importedCount": 2,
  "message": "Memories imported successfully"
}
```

---

## Utility Endpoints

### 7. Fetch URL Content
Fetches the content of a URL, strips out HTML/scripts/styles, and returns clean text. Used to reduce extraneous load when processing links.

**Endpoint:** `POST /api/fetch-url`

**Request Body:**
```json
{
  "url": "https://example.com/article"
}
```

**Response (200 OK):**
```json
{
  "text": "Cleaned text content from the URL..."
}
```

---

### 8. Parse File Upload
Extracts text from uploaded files (supports `.txt`, `.md`, `.csv`, `.json`, and `.pdf`).

**Endpoint:** `POST /api/parse-file`

**Request Body:**
`multipart/form-data` containing a `file` field.

**Response (200 OK):**
```json
{
  "text": "Extracted text content from the document..."
}
```

---

### 9. Encapsulate Memories (Arweave)
Encapsulates all existing memories for a specific user into a permanent, blockchain-verified "Capability Capsule" on Arweave via Irys.

**Endpoint:** `POST /api/memory/:userId/encapsulate`

**Request Body:**
(None required)

**Response (200 OK):**
```json
{
  "success": true,
  "txId": "arweave_tx_id",
  "hash": "sha256_hash",
  "arweaveUrl": "https://gateway.irys.xyz/arweave_tx_id",
  "bootloader": "data:text/html;base64,...",
  "message": "Memories encapsulated into Arweave capsule successfully"
}
```

---

## Rate Limiting
The API implements rate limiting per user ID to ensure stability:
- `GET` requests: 100 requests per minute
- `POST` requests: 50 requests per minute
- `PUT` requests: 50 requests per minute
- `DELETE` requests: 100 requests per minute
- `Import` requests: 10 requests per minute

When a rate limit is exceeded, the API returns a `429 Too Many Requests` status code.
