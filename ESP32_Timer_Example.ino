#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <time.h>

// Configuration
#define DEVICE_ID "ESP32_001"
#define RELAY_PIN 2
#define WS_SERVER "192.168.1.100"  // Ganti dengan IP server Anda
#define WS_PORT 8080
#define WIFI_SSID "YourWiFiSSID"
#define WIFI_PASSWORD "YourWiFiPassword"

// Timer state management
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
WebSocketsClient webSocket;

// Function prototypes
void handleStartCommand(JsonDocument& doc);
void handleStopCommand(JsonDocument& doc);
void handleEndCommand(JsonDocument& doc);
void handleAddTimeCommand(JsonDocument& doc);
void handleDisconnect();
void handleReconnection();
void sendStatusUpdate(String status);
void sendRegistration();
void sendHeartbeat();
String getCurrentTimestamp();

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  
  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Connecting to WiFi...");
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
    Serial.print(".");
  }
  
  Serial.println();
  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
  
  // Setup WebSocket
  webSocket.begin(WS_SERVER, WS_PORT, "/");
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(5000);
  
  Serial.println("ESP32 Timer Device Ready");
}

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
  StaticJsonDocument<512> doc;
  DeserializationError error = deserializeJson(doc, payload);
  
  if (error) {
    Serial.println("Failed to parse JSON");
    sendErrorResponse("invalid_json");
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
        Serial.printf("Pause duration: %lu ms\n", pauseDuration);
        Serial.printf("Remaining time: %lu seconds\n", timerState.remainingTime);
        sendStatusUpdate("timer_resumed");
      } else if (!timerState.isRunning) {
        Serial.println("No timer to resume");
        sendErrorResponse("no_timer_to_resume");
      } else {
        Serial.println("Timer already running");
        sendErrorResponse("timer_already_running");
      }
    }
  }
}

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

void handleDisconnect() {
  // Ketika disconnect, langsung pause timer jika sedang berjalan
  if (timerState.isRunning && !timerState.isPaused) {
    timerState.isPaused = true;
    timerState.pauseTime = millis();
    
    // Turn off relay untuk safety
    digitalWrite(RELAY_PIN, LOW);
    
    Serial.println("Timer paused due to disconnect");
    Serial.printf("Remaining time: %lu seconds\n", timerState.remainingTime);
    
    // Catat waktu disconnect untuk debugging
    Serial.printf("Disconnect time: %lu ms\n", timerState.pauseTime);
  }
}

void handleReconnection() {
  // Ketika reconnect, kirim status current timer
  if (timerState.isRunning) {
    if (timerState.isPaused) {
      Serial.println("Device reconnected - Timer is paused");
      // Kirim status bahwa timer di-pause
      sendStatusUpdate("timer_paused");
    } else {
      Serial.println("Device reconnected - Timer is running");
      // Kirim status bahwa timer sedang berjalan
      sendStatusUpdate("timer_running");
    }
  } else {
    Serial.println("Device reconnected - No active timer");
  }
}

void sendStatusUpdate(String status) {
  StaticJsonDocument<512> doc;
  doc["type"] = "status_update";
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  doc["timestamp"] = getCurrentTimestamp();
  
  if (status == "timer_paused" || status == "timer_resumed" || status == "timer_running") {
    doc["remainingTime"] = timerState.remainingTime;
    doc["elapsedTime"] = timerState.duration - timerState.remainingTime;
  }
  
  // Tambahkan informasi tambahan untuk disconnect
  if (status == "timer_paused" && timerState.isPaused) {
    doc["reason"] = "disconnect";
    doc["canResume"] = true;
  }
  
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
  
  Serial.printf("Status sent: %s\n", status.c_str());
}

void sendRegistration() {
  StaticJsonDocument<256> doc;
  doc["type"] = "registration";
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = getCurrentTimestamp();
  
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
  
  Serial.println("Registration sent");
}

void sendHeartbeat() {
  StaticJsonDocument<256> doc;
  doc["type"] = "heartbeat";
  doc["deviceId"] = DEVICE_ID;
  doc["timestamp"] = getCurrentTimestamp();
  doc["status"] = timerState.isRunning ? (timerState.isPaused ? "paused" : "running") : "idle";
  
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
}

void sendErrorResponse(String error) {
  StaticJsonDocument<256> doc;
  doc["type"] = "error";
  doc["deviceId"] = DEVICE_ID;
  doc["error"] = error;
  doc["timestamp"] = getCurrentTimestamp();
  
  String jsonString;
  serializeJson(doc, jsonString);
  webSocket.sendTXT(jsonString);
  
  Serial.printf("Error sent: %s\n", error.c_str());
}

String getCurrentTimestamp() {
  // Simple timestamp generation (you might want to use NTP for accurate time)
  unsigned long currentTime = millis();
  unsigned long seconds = currentTime / 1000;
  unsigned long minutes = seconds / 60;
  unsigned long hours = minutes / 60;
  
  char timestamp[32];
  snprintf(timestamp, sizeof(timestamp), "2024-01-01T%02lu:%02lu:%02lu.000Z", 
           hours % 24, minutes % 60, seconds % 60);
  
  return String(timestamp);
}

// Debug functions
void printTimerState() {
  Serial.println("=== Timer State ===");
  Serial.printf("Running: %s\n", timerState.isRunning ? "Yes" : "No");
  Serial.printf("Paused: %s\n", timerState.isPaused ? "Yes" : "No");
  Serial.printf("Duration: %lu\n", timerState.duration);
  Serial.printf("Remaining: %lu\n", timerState.remainingTime);
  Serial.printf("Total Pause: %lu\n", timerState.totalPauseTime);
  Serial.println("==================");
} 