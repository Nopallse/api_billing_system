# Penanganan Disconnect Device - Perbaikan

## Masalah Sebelumnya
Ketika device terputus saat timer sedang berjalan, sistem menganggap transaksi selesai dan mengubah status timer menjadi 'stop'. Padahal seharusnya timer di-pause dan bisa dilanjutkan ketika device terhubung kembali.

## Solusi yang Diterapkan

### 1. Perbaikan Logika Disconnect di WebSocket (`src/wsClient.js`)

#### Sebelum:
- Ketika device disconnect, timer langsung dihapus dari `activeTimers`
- Status device diubah menjadi 'stop' di database
- Transaksi dianggap selesai

#### Sesudah:
- Ketika device disconnect, timer dipindahkan dari `activeTimers` ke `pausedDevices`
- Status timer tetap 'start' di database, hanya update `lastPausedAt`
- Transaksi tetap aktif dengan status 'paused'

### 2. Penanganan Reconnect Device

#### Fitur Baru:
- Ketika device terhubung kembali, sistem mengecek apakah ada timer yang di-pause
- Jika ada, timer otomatis dilanjutkan dengan menambahkan durasi pause
- Notifikasi dikirim ke mobile client bahwa timer dilanjutkan

### 3. Status Koneksi yang Diperbaiki

#### Status Baru:
- `on`: Timer sedang berjalan
- `pause`: Timer di-pause manual
- `pause_disconnected`: Timer di-pause karena disconnect
- `off`: Device tidak memiliki timer aktif

### 4. Endpoint Baru untuk Resume Timer

#### Route: `POST /api/transactions/device/:deviceId/resume`
- Memungkinkan user untuk manual resume timer yang di-pause
- Hanya bisa digunakan untuk device yang memiliki timer yang bisa di-resume
- Mengirim command 'start' ke device untuk melanjutkan timer

### 5. Perbaikan Controller

#### Device Controller:
- `getAllDevices` dan `getDeviceById` sekarang menangani status 'pause_disconnected'
- `sendDeviceCommand` mendukung resume timer yang di-pause

#### Transaction Controller:
- Disconnect callback tidak lagi mengakhiri transaksi
- Transaksi tetap aktif dengan status 'paused'
- Fungsi `resumePausedTimer` untuk menangani resume timer

## Alur Kerja Baru

### 1. Device Disconnect saat Timer Berjalan:
1. Device terputus dari WebSocket
2. Timer dipindahkan dari `activeTimers` ke `pausedDevices`
3. Database update `lastPausedAt` tanpa mengubah `timerStatus`
4. Transaksi status diubah menjadi 'paused' (jika ada field status)
5. Notifikasi dikirim ke mobile client

### 2. Device Reconnect:
1. Device terhubung kembali ke WebSocket
2. Sistem mengecek apakah device ada di `pausedDevices`
3. Jika ada, timer dipindahkan kembali ke `activeTimers`
4. Timer dilanjutkan dengan menambahkan durasi pause
5. Notifikasi dikirim ke mobile client

### 3. Manual Resume:
1. User memanggil endpoint resume
2. Sistem validasi apakah device memiliki timer yang bisa di-resume
3. Timer dilanjutkan dengan menambahkan durasi pause
4. Command 'start' dikirim ke device
5. Transaksi status diubah menjadi 'active'

## Fungsi Baru yang Ditambahkan

### WebSocket Client:
- `isTimerPaused(deviceId)`: Mengecek apakah timer di-pause
- `canResumeTimer(deviceId)`: Mengecek apakah timer bisa di-resume

### Transaction Controller:
- `resumePausedTimer(deviceId)`: Fungsi untuk resume timer yang di-pause

## Notifikasi Mobile Client

### Tipe Notifikasi Baru:
- `timer_paused_disconnect`: Timer di-pause karena disconnect
- `timer_resumed`: Timer dilanjutkan setelah reconnect atau manual resume

## Testing

### Skenario yang Perlu Ditest:
1. Device disconnect saat timer berjalan
2. Device reconnect dan timer otomatis dilanjutkan
3. Manual resume timer melalui API
4. Status device yang benar setelah disconnect/reconnect
5. Notifikasi mobile client yang tepat

## Catatan Penting

- Timer yang di-pause karena disconnect tetap menggunakan waktu yang sama
- Transaksi tidak diakhiri ketika device disconnect
- User bisa manual resume timer melalui API jika diperlukan
- Sistem mendukung multiple device dengan status berbeda 