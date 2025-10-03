# Member Transaction API Documentation

## Overview
API ini dibuat khusus untuk menangani transaksi yang dilakukan oleh member dengan validasi PIN. Berbeda dengan transaksi biasa, transaksi member memerlukan PIN untuk autentikasi dan akan mengurangi deposit member secara otomatis.

## Base URL
```
/api/member-transactions
```

## Authentication
Semua endpoint memerlukan Bearer token di header Authorization.

## Endpoints

### 1. Create Member Transaction
**POST** `/api/member-transactions`

Membuat transaksi baru untuk member dengan validasi PIN.

**Request Body:**
```json
{
  "deviceId": "uuid",
  "start": "2024-01-01T10:00:00.000Z",
  "duration": 3600,
  "memberId": "uuid",
  "pin": "1234"
}
```

**Response Success (201):**
```json
{
  "message": "Transaksi member berhasil dibuat",
  "data": {
    "transaction": {
      "id": "uuid",
      "memberId": "uuid",
      "deviceId": "uuid",
      "start": "2024-01-01T10:00:00.000Z",
      "end": null,
      "duration": 3600,
      "cost": 50000
    },
    "deviceCommand": {...},
    "member": {
      "id": "uuid",
      "username": "member1",
      "email": "member@example.com",
      "previousDeposit": 100000,
      "newDeposit": 50000,
      "deductedAmount": 50000
    }
  }
}
```

**Response Error (401):**
```json
{
  "message": "PIN tidak valid"
}
```

**Response Error (400):**
```json
{
  "message": "Deposit tidak mencukupi",
  "data": {
    "currentDeposit": 10000,
    "requiredCost": 50000,
    "shortfall": 40000
  }
}
```

### 2. Get All Member Transactions
**GET** `/api/member-transactions`

Mendapatkan semua transaksi member dengan filter opsional.

**Query Parameters:**
- `start_date` (optional): Filter dari tanggal (format: YYYY-MM-DD)
- `end_date` (optional): Filter sampai tanggal (format: YYYY-MM-DD)
- `page` (optional): Halaman (default: 1)
- `limit` (optional): Jumlah item per halaman (default: 10)
- `memberId` (optional): Filter berdasarkan member ID

**Response Success (200):**
```json
{
  "message": "Success",
  "data": {
    "transactions": [
      {
        "id": "uuid",
        "memberId": "uuid",
        "deviceId": "uuid",
        "start": "2024-01-01T10:00:00.000Z",
        "end": "2024-01-01T11:00:00.000Z",
        "duration": 3600,
        "cost": 50000,
        "Device": {
          "id": "uuid",
          "name": "Device 1",
          "Category": {
            "id": "uuid",
            "name": "Gaming",
            "cost": 1000,
            "periode": 60
          }
        },
        "member": {
          "id": "uuid",
          "username": "member1",
          "email": "member@example.com",
          "deposit": 50000
        }
      }
    ],
    "pagination": {
      "totalItems": 50,
      "totalPages": 5,
      "currentPage": 1,
      "itemsPerPage": 10,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

### 3. Get Member Transaction by ID
**GET** `/api/member-transactions/:id`

Mendapatkan transaksi member berdasarkan ID.

**Response Success (200):**
```json
{
  "message": "Success",
  "data": {
    "id": "uuid",
    "memberId": "uuid",
    "deviceId": "uuid",
    "start": "2024-01-01T10:00:00.000Z",
    "end": "2024-01-01T11:00:00.000Z",
    "duration": 3600,
    "cost": 50000,
    "Device": {...},
    "member": {...}
  }
}
```

### 4. Get Member Transactions by Member ID
**GET** `/api/member-transactions/member/:memberId`

Mendapatkan semua transaksi dari member tertentu.

**Query Parameters:**
- `start_date` (optional): Filter dari tanggal
- `end_date` (optional): Filter sampai tanggal
- `page` (optional): Halaman
- `limit` (optional): Jumlah item per halaman

**Response:** Sama seperti endpoint "Get All Member Transactions"

### 5. Update Member Transaction
**PUT** `/api/member-transactions/:id`

Update transaksi member.

**Request Body:**
```json
{
  "start": "2024-01-01T10:00:00.000Z",
  "end": "2024-01-01T11:00:00.000Z",
  "duration": 3600,
  "cost": 50000
}
```

### 6. Delete Member Transaction
**DELETE** `/api/member-transactions/:id`

Hapus transaksi member.

**Response Success (200):**
```json
{
  "message": "Transaction deleted successfully"
}
```

## Fitur Khusus

### 1. Validasi PIN
- Setiap pembuatan transaksi member memerlukan PIN yang valid
- PIN akan diverifikasi menggunakan bcrypt

### 2. Pengurangan Deposit Otomatis
- Deposit member akan dikurangi secara otomatis sesuai dengan cost transaksi
- Jika deposit tidak mencukupi, transaksi akan ditolak

### 3. Rollback Otomatis
- Jika gagal mengirim command ke ESP32, transaksi akan dihapus dan deposit dikembalikan

### 4. Validasi Device
- Device harus terkoneksi ke WebSocket server
- Device tidak boleh memiliki timer aktif atau paused

## Error Codes

- `400`: Bad Request (input tidak valid, deposit tidak mencukupi, dll)
- `401`: Unauthorized (PIN tidak valid)
- `404`: Not Found (member, device, atau transaksi tidak ditemukan)
- `500`: Internal Server Error

## Contoh Penggunaan

### Membuat Transaksi Member
```bash
curl -X POST http://localhost:3000/api/member-transactions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "deviceId": "device-uuid",
    "start": "2024-01-01T10:00:00.000Z",
    "duration": 3600,
    "memberId": "member-uuid",
    "pin": "1234"
  }'
```

### Mendapatkan Transaksi Member
```bash
curl -X GET "http://localhost:3000/api/member-transactions?memberId=member-uuid&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```
