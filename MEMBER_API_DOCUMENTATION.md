# Member API Documentation

## Overview
Member API menyediakan endpoint untuk mengelola data member dalam sistem billing. Semua endpoint memerlukan authentication kecuali yang disebutkan sebagai public.

## Authentication
Semua endpoint Member API memerlukan authentication menggunakan Bearer token di header:
```
Authorization: Bearer <your_jwt_token>
```

## Base URL
```
/api/member
```

---

## Endpoints

### 1. Get All Members
Mendapatkan daftar semua member dengan pagination dan pencarian.

**Endpoint:** `GET /api/member`

**Headers:**
- `Authorization: Bearer <token>` (required)

**Query Parameters:**
- `page` (optional, number): Halaman yang ingin ditampilkan. Default: 1
- `limit` (optional, number): Jumlah item per halaman. Default: 10
- `search` (optional, string): Keyword pencarian berdasarkan email atau username

**Example Request:**
```http
GET /api/member?page=1&limit=10&search=john
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Members retrieved successfully",
  "data": {
    "members": [
      {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "email": "john.doe@example.com",
        "username": "johndoe",
        "deposit": "100000.00",
        "createdAt": "2025-09-07T10:00:00.000Z",
        "updatedAt": "2025-09-07T10:00:00.000Z",
        "transactions": [
          {
            "id": "trans-uuid-1",
            "start": "2025-09-07T14:30:00.000Z",
            "end": "2025-09-07T15:30:00.000Z",
            "duration": 60,
            "cost": 5000,
            "createdAt": "2025-09-07T14:30:00.000Z"
          }
        ]
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 2,
      "totalItems": 15,
      "itemsPerPage": 10
    }
  }
}
```

---

### 2. Get Member by ID
Mendapatkan detail member berdasarkan ID.

**Endpoint:** `GET /api/member/:id`

**Headers:**
- `Authorization: Bearer <token>` (required)

**Path Parameters:**
- `id` (required, UUID): ID member yang ingin diambil

**Example Request:**
```http
GET /api/member/550e8400-e29b-41d4-a716-446655440001
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Member retrieved successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "email": "john.doe@example.com",
    "username": "johndoe",
    "deposit": "100000.00",
    "createdAt": "2025-09-07T10:00:00.000Z",
    "updatedAt": "2025-09-07T10:00:00.000Z",
    "transactions": [
      {
        "id": "trans-uuid-1",
        "start": "2025-09-07T14:30:00.000Z",
        "end": "2025-09-07T15:30:00.000Z",
        "duration": 60,
        "cost": 5000,
        "createdAt": "2025-09-07T14:30:00.000Z"
      }
    ]
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Member not found"
}
```

---

### 3. Create Member
Membuat member baru.

**Endpoint:** `POST /api/member`

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json` (required)

**Request Body:**
```json
{
  "email": "new.member@example.com",
  "username": "newmember",
  "pin": "1234"
}
```

**Body Parameters:**
- `email` (required, string): Email member (harus unique)
- `username` (required, string): Username member (harus unique)  
- `pin` (required, string): PIN member (akan di-hash secara otomatis)
- `deposit` (optional, number): Saldo deposit awal. Default: 0.00 jika tidak diisi

**Example Request (tanpa deposit):**
```http
POST /api/member
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "email": "new.member@example.com",
  "username": "newmember",
  "pin": "1234"
}
```

**Example Request (dengan deposit):**
```http
POST /api/member
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "email": "member.with.deposit@example.com",
  "username": "memberwithdeposit",
  "pin": "1234",
  "deposit": 50000.00
}
```

**Success Response (201) - tanpa deposit:**
```json
{
  "success": true,
  "message": "Member created successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "email": "new.member@example.com",
    "username": "newmember",
    "deposit": "0.00",
    "createdAt": "2025-09-07T12:00:00.000Z",
    "updatedAt": "2025-09-07T12:00:00.000Z"
  }
}
```

**Success Response (201) - dengan deposit:**
```json
{
  "success": true,
  "message": "Member created successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440005",
    "email": "member.with.deposit@example.com",
    "username": "memberwithdeposit",
    "deposit": "50000.00",
    "createdAt": "2025-09-07T12:00:00.000Z",
    "updatedAt": "2025-09-07T12:00:00.000Z"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Email, username, and pin are required"
}
```

**Error Response (409):**
```json
{
  "success": false,
  "message": "Email or username already exists"
}
```

---

### 4. Update Member
Memperbarui data member.

**Endpoint:** `PUT /api/member/:id`

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json` (required)

**Path Parameters:**
- `id` (required, UUID): ID member yang ingin diupdate

**Request Body:**
```json
{
  "email": "updated.email@example.com",
  "username": "updatedusername",
  "pin": "5678",
  "deposit": 75000.00
}
```

**Body Parameters:**
- `email` (optional, string): Email baru (harus unique)
- `username` (optional, string): Username baru (harus unique)
- `pin` (optional, string): PIN baru (akan di-hash)
- `deposit` (optional, number): Saldo deposit baru

**Example Request:**
```http
PUT /api/member/550e8400-e29b-41d4-a716-446655440001
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "email": "updated.email@example.com",
  "deposit": 75000.00
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Member updated successfully",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "email": "updated.email@example.com",
    "username": "johndoe",
    "deposit": "75000.00",
    "createdAt": "2025-09-07T10:00:00.000Z",
    "updatedAt": "2025-09-07T12:30:00.000Z"
  }
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Member not found"
}
```

---

### 5. Delete Member
Menghapus member dari sistem.

**Endpoint:** `DELETE /api/member/:id`

**Headers:**
- `Authorization: Bearer <token>` (required)

**Path Parameters:**
- `id` (required, UUID): ID member yang ingin dihapus

**Example Request:**
```http
DELETE /api/member/550e8400-e29b-41d4-a716-446655440001
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Member deleted successfully"
}
```

**Error Response (404):**
```json
{
  "success": false,
  "message": "Member not found"
}
```

**Error Response (409) - Has Transactions:**
```json
{
  "success": false,
  "message": "Cannot delete member. Member has 5 associated transactions.",
  "suggestion": "Consider deactivating the member instead or remove associated transactions first."
}
```

---

### 6. Top Up Member Deposit
Menambah saldo deposit member.

**Endpoint:** `POST /api/member/:id/topup`

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json` (required)

**Path Parameters:**
- `id` (required, UUID): ID member

**Request Body:**
```json
{
  "amount": 25000.00
}
```

**Body Parameters:**
- `amount` (required, number): Jumlah yang akan ditambahkan (harus > 0)

**Example Request:**
```http
POST /api/member/550e8400-e29b-41d4-a716-446655440001/topup
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "amount": 25000.00
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Successfully topped up 25000. New deposit balance: 125000",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "email": "john.doe@example.com",
    "username": "johndoe",
    "deposit": "125000.00",
    "createdAt": "2025-09-07T10:00:00.000Z",
    "updatedAt": "2025-09-07T13:00:00.000Z",
    "previousDeposit": "100000.00",
    "topUpAmount": 25000.00,
    "newDeposit": 125000.00
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Top up amount must be greater than 0"
}
```

---

### 7. Deduct Member Deposit
Mengurangi saldo deposit member.

**Endpoint:** `POST /api/member/:id/deduct`

**Headers:**
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json` (required)

**Path Parameters:**
- `id` (required, UUID): ID member

**Request Body:**
```json
{
  "amount": 15000.00
}
```

**Body Parameters:**
- `amount` (required, number): Jumlah yang akan dikurangi (harus > 0)

**Example Request:**
```http
POST /api/member/550e8400-e29b-41d4-a716-446655440001/deduct
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "amount": 15000.00
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Successfully deducted 15000. New deposit balance: 85000",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "email": "john.doe@example.com",
    "username": "johndoe",
    "deposit": "85000.00",
    "createdAt": "2025-09-07T10:00:00.000Z",
    "updatedAt": "2025-09-07T13:30:00.000Z",
    "previousDeposit": 100000.00,
    "deductedAmount": 15000.00,
    "newDeposit": 85000.00
  }
}
```

**Error Response (400) - Insufficient Balance:**
```json
{
  "success": false,
  "message": "Insufficient deposit balance",
  "data": {
    "currentDeposit": 25000.00,
    "requestedAmount": 50000.00,
    "shortfall": 25000.00
  }
}
```

---

## Error Responses

### Common HTTP Status Codes:
- **200**: Success
- **201**: Created successfully
- **400**: Bad Request (validation error, insufficient balance, etc.)
- **401**: Unauthorized (invalid or missing token)
- **404**: Not Found (member doesn't exist)
- **409**: Conflict (email/username already exists, cannot delete due to constraints)
- **500**: Internal Server Error

### Authentication Errors:
```json
{
  "message": "No token provided"
}
```

```json
{
  "message": "Invalid token format. Use: Bearer <token>"
}
```

```json
{
  "message": "Token expired"
}
```

---

## Data Models

### Member Object:
```json
{
  "id": "UUID",
  "email": "string (unique)",
  "username": "string (unique)",
  "deposit": "decimal(15,2)",
  "createdAt": "datetime",
  "updatedAt": "datetime",
  "transactions": [
    {
      "id": "UUID",
      "start": "datetime",
      "end": "datetime", 
      "duration": "integer (minutes)",
      "cost": "integer",
      "createdAt": "datetime"
    }
  ]
}
```

**Note:** 
- Field `pin` tidak pernah dikembalikan dalam response untuk keamanan
- Field `transactions` hanya muncul pada endpoint GET (detail dan list)
- Semua amount/deposit dalam format decimal dengan 2 angka desimal
- ID menggunakan format UUID v4
