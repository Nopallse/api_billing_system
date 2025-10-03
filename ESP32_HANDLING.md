# ESP32 Handling untuk Pause dan Resume Timer

## Overview
Dokumen ini menjelaskan handle yang perlu ditambahkan di ESP32 untuk mendukung fitur pause dan resume timer ketika device terputus dan terhubung kembali.

## 1. Command yang Diterima dari Server

### Format Command WebSocket
```json
{
  "type": "command",
  "deviceId": "ESP32_001",
  "command": "start|stop|end",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Command untuk Timer Baru
```json
{
  "type": "command", 
  "deviceId": "ESP32_001",
  "command": "start",
  "timer": 3600,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### Command untuk Add Time
```json
{
  "type": "add_time",
  "deviceId": "ESP32_001", 
  "additionalTime": 300,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 2. Handle yang Perlu Ditambahkan di ESP32

### 2.1 State Management
```cpp
// Tambahkan variabel state untuk pause/resume
struct TimerState {
  bool isRunning = false;
  bool isPaused = false;
  unsigned long startTime = 0;
  unsigned long pauseTime = 0;
  unsigned long totalPauseTime = 0;
  unsigned long duration = 0;
  unsigned long remainingTime = 0;
};

TimerState timerState;
```

### 2.2 Handle Command 'start' untuk Resume
```cpp
void handleStartCommand(JsonDocument& doc) {
  String command = doc["command"];
  
  if (command == "start") {
    // Cek apakah ada field timer (timer baru) atau tidak (resume)
    if (doc.containsKey("timer")) {
      // Start new timer
      if (!timerState.isRunning) {
        timerState.isRunning = true;
        timerState.isPaused = false;
        timerState.startTime = millis();
        timerState.totalPauseTime = 0;
        timerState.duration = doc["timer"];
        timerState.remainingTime = timerState.duration;
        
        digitalWrite(RELAY_PIN, HIGH);
        
        Serial.printf("Timer started for %lu seconds\n", timerState.duration);
        sendStatusUpdate("timer_started");
      } else {
        Serial.println("Timer already running, cannot start new timer");
        sendErrorResponse("timer_already_running");
      }
    } else {
      // Resume timer yang di-pause
      if (timerState.isPaused) {
        unsigned long currentTime = millis();
        unsigned long pauseDuration = currentTime - timerState.pauseTime;
        timerState.totalPauseTime += pauseDuration;
        timerState.isPaused = false;
        timerState.isRunning = true;
        
        // Update remaining time
        unsigned long elapsedTime = (currentTime - timerState.startTime - timerState.totalPauseTime) / 1000;
        timerState.remainingTime = timerState.duration - elapsedTime;
        
        // Turn on relay
        digitalWrite(RELAY_PIN, HIGH);
        
        Serial.println("Timer resumed");
        sendStatusUpdate("timer_resumed");
      } else {
        Serial.println("No timer to resume");
        sendErrorResponse("no_timer_to_resume");
      }
    }
  }
}
```

### 2.3 Handle Command 'stop' untuk Pause
```cpp
void handleStopCommand(JsonDocument& doc) {
  String command = doc["command"];
  
  if (command == "stop" && timerState.isRunning && !timerState.isPaused) {
    // Pause timer
    timerState.isPaused = true;
    timerState.pauseTime = millis();
    
    // Turn off relay
    digitalWrite(RELAY_PIN, LOW);
    
    Serial.println("Timer paused");
    sendStatusUpdate("timer_paused");
  }
}
```

### 2.4 Handle Command 'end' untuk Stop Permanen
```cpp
void handleEndCommand(JsonDocument& doc) {
  String command = doc["command"];
  
  if (command == "end") {
    // Stop timer permanently
    timerState.isRunning = false;
    timerState.isPaused = false;
    timerState.startTime = 0;
    timerState.pauseTime = 0;
    timerState.totalPauseTime = 0;
    timerState.duration = 0;
    timerState.remainingTime = 0;
    
    // Turn off relay
    digitalWrite(RELAY_PIN, LOW);
    
    Serial.println("Timer ended");
    sendStatusUpdate("timer_ended");
  }
}
```

### 2.5 Handle Add Time Command
```cpp
void handleAddTimeCommand(JsonDocument& doc) {
  if (doc["type"] == "add_time") {
    unsigned long additionalTime = doc["additionalTime"];
    
    if (timerState.isRunning) {
      timerState.duration += additionalTime;
      timerState.remainingTime += additionalTime;
      
      Serial.printf("Added %lu seconds to timer\n", additionalTime);
      sendStatusUpdate("time_added");
    }
  }
}
```

### 2.6 Timer Loop dengan Pause Support
```cpp
void timerLoop() {
  if (timerState.isRunning && !timerState.isPaused) {
    unsigned long currentTime = millis();
    unsigned long elapsedTime = (currentTime - timerState.startTime - timerState.totalPauseTime) / 1000;
    
    if (elapsedTime >= timerState.duration) {
      // Timer completed
      timerState.isRunning = false;
      timerState.isPaused = false;
      digitalWrite(RELAY_PIN, LOW);
      
      Serial.println("Timer completed");
      sendStatusUpdate("relay_off");
    } else {
      // Update remaining time
      timerState.remainingTime = timerState.duration - elapsedTime;
    }
  }
}
```

### 2.7 Status Update Function
```cpp
void sendStatusUpdate(String status) {
  JsonDocument doc;
  doc["type"] = "status_update";
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  doc["timestamp"] = getCurrentTimestamp();
  
  if (status == "timer_paused" || status == "timer_resumed") {
    doc["remainingTime"] = timerState.remainingTime;
    doc["elapsedTime"] = timerState.duration - timerState.remainingTime;
  }
  
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
}
```

### 2.8 WebSocket Message Handler
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
      
    case WStype_TEXT:
      handleWebSocketMessage(payload, length);
      break;
  }
}

void handleWebSocketMessage(uint8_t * payload, size_t length) {
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, payload);
  
  if (error) {
    Serial.println("Failed to parse JSON");
    return;
  }
  
  String type = doc["type"];
  
  if (type == "command") {
    String command = doc["command"];
    
    if (command == "start") {
      handleStartCommand(doc);
    } else if (command == "stop") {
      handleStopCommand(doc);
    } else if (command == "end") {
      handleEndCommand(doc);
    }
  } else if (type == "add_time") {
    handleAddTimeCommand(doc);
  }
}
```

### 2.9 Disconnect Handler
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

### 2.10 Reconnection Handler
```cpp
void handleReconnection() {
  // Ketika terhubung kembali, kirim status current timer
  if (timerState.isRunning) {
    if (timerState.isPaused) {
      Serial.println("Device reconnected - Timer is paused");
      sendStatusUpdate("timer_paused");
    } else {
      Serial.println("Device reconnected - Timer is running");
      sendStatusUpdate("timer_running");
    }
  } else {
    Serial.println("Device reconnected - No active timer");
  }
}
```

## 3. Implementasi Lengkap ESP32

### 3.1 Header dan Include
```cpp
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>

#define DEVICE_ID "ESP32_001"
#define RELAY_PIN 2
#define WS_SERVER "192.168.1.100"
#define WS_PORT 8080

WebSocketsClient webSocket;
```

### 3.2 Setup Function
```cpp
void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.println("Connecting to WiFi...");
  }
  
  // Setup WebSocket
  webSocket.begin(WS_SERVER, WS_PORT, "/");
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  Serial.println("ESP32 Timer Device Ready");
}
```

### 3.3 Loop Function
```cpp
void loop() {
  webSocket.loop();
  timerLoop();
  
  // Send heartbeat every 30 seconds
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat > 30000) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
}
```

## 4. Status yang Dikirim ke Server

### 4.1 Timer Started
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "timer_started",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 4.2 Timer Paused
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "timer_paused",
  "remainingTime": 1800,
  "elapsedTime": 1800,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 4.3 Timer Resumed
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "timer_resumed",
  "remainingTime": 1800,
  "elapsedTime": 1800,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 4.4 Timer Paused (Disconnect)
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

### 4.5 Timer Running (Reconnect)
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

### 4.6 Timer Completed
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "relay_off",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 4.7 Time Added
```json
{
  "type": "status_update",
  "deviceId": "ESP32_001",
  "status": "time_added",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 5. Testing Scenarios

### 5.1 Disconnect saat Timer Berjalan
1. Start timer di ESP32
2. Disconnect WiFi/power
3. Verify timer langsung pause dan relay OFF
4. Reconnect setelah beberapa detik
5. Verify ESP32 kirim status "timer_paused"
6. Send resume command dari server
7. Verify timer resume dengan waktu yang tepat

### 5.2 Manual Pause/Resume
1. Start timer
2. Send 'stop' command
3. Verify relay off dan status 'timer_paused'
4. Send 'start' command
5. Verify relay on dan status 'timer_resumed'

### 5.3 Add Time
1. Start timer
2. Send 'add_time' command
3. Verify duration bertambah
4. Verify remaining time bertambah

## 6. Error Handling

### 6.1 JSON Parse Error
```cpp
if (error) {
  Serial.println("Failed to parse JSON");
  sendErrorResponse("invalid_json");
  return;
}
```

### 6.2 Invalid Command
```cpp
void sendErrorResponse(String error) {
  JsonDocument doc;
  doc["type"] = "error";
  doc["deviceId"] = DEVICE_ID;
  doc["error"] = error;
  doc["timestamp"] = getCurrentTimestamp();
  
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
}
```

## 7. Memory Management

### 7.1 JSON Document Size
```cpp
// Gunakan StaticJsonDocument untuk efisiensi memory
StaticJsonDocument<512> doc;
```

### 7.2 String Management
```cpp
// Gunakan String dengan reserve untuk menghindari fragmentation
String jsonString;
jsonString.reserve(256);
```

## 8. Best Practices

1. **Always validate JSON before processing**
2. **Use millis() instead of delay() for non-blocking operations**
3. **Implement proper error handling for all commands**
4. **Send status updates for all state changes**
5. **Use StaticJsonDocument for memory efficiency**
6. **Implement heartbeat to detect connection issues**
7. **Store timer state in non-volatile memory if needed** 