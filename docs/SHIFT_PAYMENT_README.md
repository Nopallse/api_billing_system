# Sistem Shift & Pembayaran

Dokumen ini menjelaskan alur kerja sistem shift dan pembayaran untuk manajemen kasir dan rekonsiliasi keuangan per shift.

## Ikhtisar

Sistem ini memungkinkan:
- **Tracking shift kasir** (3 shift/hari)
- **Pencatatan pembayaran** terhubung ke shift aktif
- **Rekonsiliasi kas** di akhir shift
- **Laporan pendapatan per shift**

---

## Alur Kerja

### 1. Mulai Shift

```
POST /api/shift/start
Body: { "initialCash": 100000 }
```

Kasir memulai shift dengan menyebutkan uang awal di laci kas.

### 2. Transaksi Pelanggan

#### A. Bayar di Awal (Upfront)
```
POST /api/transaction/create
Body: { "deviceId": "...", "start": "...", "duration": 3600, "paymentMethod": "CASH" }
```
- Transaksi dibuat dengan status `active`
- **Payment otomatis tercatat** ke shift kasir saat ini

#### B. Bayar di Akhir (Pay Later)
```
POST /api/transaction/regular/create  → Mulai timer (tanpa bayar)
POST /api/transaction/regular/finish → Selesai & bayar
```
- Saat `finish`, payment rental + produk tercatat ke shift **saat pembayaran** (bukan saat mulai)

### 3. Tambah Produk ke Transaksi Aktif

```
POST /api/transactions/:transactionId/products
Body: { "productId": "...", "quantity": 2 }
```

Produk ditambahkan ke transaksi. Pembayaran produk tercatat saat transaksi selesai.

### 4. Tutup Shift

```
POST /api/shift/end
Body: { "finalCash": 250000, "note": "Serah terima ke Kasir B" }
```

Sistem akan menghitung:
- `expectedCash` = initialCash + total cash payments
- `difference` = finalCash - expectedCash
- Status: `BALANCED`, `SURPLUS`, atau `DEFICIT`

---

## Diagram Alur

```
┌─────────────────────────────────────────────────────────────────┐
│                         SHIFT A (PAGI)                          │
├─────────────────────────────────────────────────────────────────┤
│  09:00  Kasir A START SHIFT (initialCash: 100rb)                │
│  09:15  Customer 1 - Bayar Awal 50rb → Payment ke Shift A       │
│  10:00  Customer 2 - Mulai (Pay Later)                          │
│  11:00  Customer 1 - Tambah waktu 30rb → Payment ke Shift A     │
│  12:00  Kasir A TUTUP SHIFT (expectedCash: 180rb)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         SHIFT B (SIANG)                         │
├─────────────────────────────────────────────────────────────────┤
│  12:00  Kasir B START SHIFT (initialCash: 180rb)                │
│  12:30  Customer 2 - SELESAI bayar 75rb → Payment ke Shift B    │
│  13:00  Customer 3 - Bayar Awal 40rb → Payment ke Shift B       │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

**Catatan Penting:**
- Customer 2 **mulai di Shift A** tapi **bayar di Shift B**
- Uang 75rb masuk ke **laporan Shift B** (karena uang fisik ada di laci Shift B)

---

## API Endpoints

| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/shift/start` | Mulai shift baru |
| POST | `/api/shift/end` | Tutup shift |
| GET | `/api/shift/status` | Cek shift aktif & ringkasan |
| GET | `/api/shift/history` | Riwayat semua shift |
| GET | `/api/shift/:id/report` | Laporan detail shift |

---

## Model Data

### Shift
| Field | Tipe | Deskripsi |
|-------|------|-----------|
| id | UUID | Primary key |
| userId | UUID | Kasir |
| startTime | DateTime | Waktu mulai |
| endTime | DateTime | Waktu selesai |
| initialCash | Integer | Uang awal di laci |
| finalCash | Integer | Uang akhir (aktual) |
| expectedCash | Integer | Uang seharusnya (sistem) |
| status | Enum | `open` / `closed` |

### Payment
| Field | Tipe | Deskripsi |
|-------|------|-----------|
| id | UUID | Primary key |
| shiftId | UUID | Shift saat pembayaran |
| transactionId | UUID | Transaksi terkait |
| amount | Integer | Jumlah pembayaran |
| type | Enum | `RENTAL`, `FNB`, `PENALTY`, `TOPUP`, `OTHER` |
| paymentMethod | Enum | `CASH`, `QRIS`, `TRANSFER`, `DEBIT`, `CREDIT` |

---

## Laporan Shift

Response dari `GET /api/shift/:id/report`:

```json
{
  "shift": {
    "startTime": "2026-01-14T08:00:00",
    "endTime": "2026-01-14T14:00:00",
    "initialCash": 100000,
    "finalCash": 350000,
    "expectedCash": 350000
  },
  "summary": {
    "totalRevenue": 250000,
    "totalCash": 200000,
    "totalNonCash": 50000,
    "byType": {
      "RENTAL": 180000,
      "FNB": 70000
    },
    "byMethod": {
      "CASH": 200000,
      "QRIS": 50000
    },
    "transactionCount": 15
  }
}
```
