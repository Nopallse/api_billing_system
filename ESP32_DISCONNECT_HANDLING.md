# ESP32 Disconnect Handling - Perbaikan

## Masalah Sebelumnya
Ketika ESP32 disconnect saat timer berjalan, timer tetap berjalan di ESP32 tanpa pause. Ini menyebabkan ketidakakuratan waktu dan potensi masalah keamanan.

## Solusi yang Diterapkan

### 1. Auto Pause saat Disconnect

Ketika WebSocket disconnect, ESP32 akan langsung:
- Pause timer yang sedang berjalan
- Turn OFF relay untuk safety
- Simpan state pause dengan waktu yang akurat
- Kirim status "timer_paused" ketika reconnect

### 2. Implementasi di ESP32

#### WebSocket Event Handler
```cpp
void onWebSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("Disconnected from WebSocket");
      // Ketika disconnect, langsung pause timer jika sedang berjalan
      handleDisconnect();
      break;
      
    case WStype_CONNECTED:
      Serial.println("Connected to WebSocket");
      sendRegistration();
      // Ketika reconnect, kirim status current timer
      handleReconnection();
      break;
  }
}
```

#### Disconnect Handler
```cpp
void handleDisconnect() {
  // Ketika disconnect, langsung pause timer jika sedang berjalan
  if (timerState.isRunning && !timerState.isPaused) {
    timerState.isPaused = true;
    timerState.pauseTime = millis();
    
    // Turn off relay untuk safety
    digitalWrite(RELAY_PIN, LOW);
    
    Serial.println("Timer paused due to disconnect");
    Serial.printf("Remaining time: %lu seconds\n", timerState.remainingTime);
  }
}
```

#### Reconnection Handler
```cpp
void handleReconnection() {
  // Ketika reconnect, kirim status current timer
  if (timerState.isRunning) {
    if (timerState.isPaused) {
      Serial.println("Device reconnected - Timer is paused");
      sendStatusUpdate("timer_paused");
    } else {
      Serial.println("Device reconnected - Timer is running");
      sendStatusUpdate("timer_running");
    }
  }
}
```

### 3. Status yang Dikirim ke Server

#### Timer Paused (Disconnect)
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "timer_paused",
  "remainingTime": 1800,
  "elapsedTime": 1800,
  "reason": "disconnect",
  "canResume": true,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

#### Timer Running (Reconnect)
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "timer_running",
  "remainingTime": 1800,
  "elapsedTime": 1800,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 4. Alur Kerja Lengkap

#### Skenario: Disconnect saat Timer Berjalan
1. **Timer sedang berjalan** → Relay ON, countdown aktif
2. **WiFi/WebSocket disconnect** → `WStype_DISCONNECTED` event
3. **ESP32 handle disconnect** → Pause timer, relay OFF
4. **Simpan state** → `isPaused = true`, `pauseTime = millis()`
5. **WiFi/WebSocket reconnect** → `WStype_CONNECTED` event
6. **ESP32 send status** → Kirim "timer_paused" ke server
7. **Server detect** → Update database, notify mobile
8. **User resume** → Server kirim "start" command
9. **ESP32 resume** → Relay ON, lanjutkan countdown

### 5. Keuntungan Implementasi

#### Safety
- **Relay OFF otomatis** saat disconnect untuk mencegah overuse
- **State preservation** untuk resume yang akurat
- **Error handling** yang robust

#### Accuracy
- **Waktu pause yang tepat** menggunakan `millis()`
- **Perhitungan remaining time** yang akurat
- **Sinkronisasi dengan server** yang konsisten

#### User Experience
- **Auto pause** tanpa intervensi user
- **Resume yang mudah** dengan satu command
- **Notifikasi real-time** ke mobile app

### 6. Testing Scenarios

#### Test 1: Disconnect saat Timer Berjalan
```bash
# 1. Start timer
curl -X POST "http://localhost:3000/api/transaction/create" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"deviceId":"ESP32_001","duration":3600}'

# 2. Disconnect ESP32 (unplug WiFi/power)
# 3. Verify relay OFF dan timer pause
# 4. Reconnect ESP32
# 5. Verify status "timer_paused" dikirim
# 6. Resume timer
curl -X POST "http://localhost:3000/api/transaction/device/ESP32_001/resume" \
  -H "Authorization: Bearer TOKEN"
```

#### Test 2: Multiple Disconnect/Reconnect
```bash
# Test multiple disconnect/reconnect cycles
# Verify timer tetap akurat setelah setiap cycle
```

### 7. Debug Information

ESP32 akan menampilkan debug info:
```
Timer paused due to disconnect
Remaining time: 1800 seconds
Disconnect time: 1234567 ms

Device reconnected - Timer is paused
Status sent: timer_paused

Timer resumed
Pause duration: 5000 ms
Remaining time: 1795 seconds
```

### 8. Integration dengan Server

Server akan menerima status dan:
1. **Update database** dengan `lastPausedAt`
2. **Notify mobile clients** dengan `timer_paused_disconnect`
3. **Enable resume functionality** untuk user
4. **Track disconnect duration** untuk billing

### 9. Best Practices

1. **Always turn off relay** saat disconnect untuk safety
2. **Use millis()** untuk timing yang akurat
3. **Send status immediately** saat reconnect
4. **Preserve timer state** untuk resume yang tepat
5. **Add debug logging** untuk troubleshooting

### 10. Error Handling

- **JSON parse error**: Send error response
- **WebSocket error**: Auto reconnect dengan exponential backoff
- **Timer overflow**: Handle millis() overflow
- **Memory issues**: Use StaticJsonDocument untuk efisiensi

Implementasi ini memastikan bahwa ESP32 selalu dalam state yang aman dan akurat, bahkan ketika terjadi disconnect yang tidak terduga. 