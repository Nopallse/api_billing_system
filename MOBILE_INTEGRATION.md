# Flutter Mobile Integration Guide

## Real-time Timer Notifications

Sistem ini menyediakan notifikasi real-time untuk Flutter mobile app ketika IoT device disconnect atau timer berubah status.

## 1. Dependencies

Tambahkan dependencies berikut ke `pubspec.yaml`:

```yaml
dependencies:
  flutter:
    sdk: flutter
  web_socket_channel: ^2.4.0
  http: ^1.1.0
  shared_preferences: ^2.2.2
  flutter_local_notifications: ^16.3.0
  provider: ^6.1.1
  intl: ^0.19.0
```

## 2. WebSocket Connection (Recommended)

### WebSocket Service Class
```dart
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/status.dart' as status;

class WebSocketService {
  WebSocketChannel? _channel;
  bool _isConnected = false;
  int _reconnectAttempts = 0;
  final int _maxReconnectAttempts = 5;
  final String _serverUrl = 'ws://localhost:3000';
  
  // Callbacks
  Function(Map<String, dynamic>)? onDeviceDisconnect;
  Function(Map<String, dynamic>)? onTimerDisconnect;
  Function()? onConnectionEstablished;
  Function(String)? onError;

  void connect() {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(_serverUrl));
      _setupListeners();
      _registerAsMobileClient();
    } catch (e) {
      _handleError('Connection failed: $e');
    }
  }

  void _setupListeners() {
    _channel?.stream.listen(
      (message) {
        _handleMessage(message);
      },
      onError: (error) {
        _handleError('WebSocket error: $error');
        _reconnect();
      },
      onDone: () {
        _isConnected = false;
        _handleError('WebSocket connection closed');
        _reconnect();
      },
    );
  }

  void _handleMessage(dynamic message) {
    try {
      final data = jsonDecode(message);
      print('Received notification: $data');
      
      switch (data['type']) {
        case 'device_disconnect':
          onDeviceDisconnect?.call(data);
          break;
        case 'timer_disconnected':
          onTimerDisconnect?.call(data);
          break;
        case 'registration':
          print('Registration confirmed');
          break;
      }
    } catch (e) {
      _handleError('Error parsing message: $e');
    }
  }

  void _registerAsMobileClient() {
    final message = jsonEncode({
      'type': 'mobile_client',
    });
    _channel?.sink.add(message);
  }

  void _reconnect() {
    if (_reconnectAttempts < _maxReconnectAttempts) {
      _reconnectAttempts++;
      final delay = (1000 * pow(2, _reconnectAttempts)).clamp(1000, 30000);
      
      Future.delayed(Duration(milliseconds: delay), () {
        print('Attempting to reconnect (${_reconnectAttempts}/${_maxReconnectAttempts})');
        connect();
      });
    }
  }

  void _handleError(String error) {
    print(error);
    onError?.call(error);
  }

  void disconnect() {
    _channel?.sink.close(status.goingAway);
    _isConnected = false;
  }

  bool get isConnected => _isConnected;
}
```

### Timer Model
```dart
class TimerModel {
  final String deviceId;
  final int elapsedTime;
  final String status;
  final String? transactionId;
  final DateTime? disconnectTime;

  TimerModel({
    required this.deviceId,
    required this.elapsedTime,
    required this.status,
    this.transactionId,
    this.disconnectTime,
  });

  factory TimerModel.fromJson(Map<String, dynamic> json) {
    return TimerModel(
      deviceId: json['deviceId'],
      elapsedTime: json['elapsedTime'] ?? 0,
      status: json['status'] ?? 'off',
      transactionId: json['transactionId'],
      disconnectTime: json['timestamp'] != null 
          ? DateTime.parse(json['timestamp']) 
          : null,
    );
  }

  String get formattedTime {
    final hours = elapsedTime ~/ 3600;
    final minutes = (elapsedTime % 3600) ~/ 60;
    final seconds = elapsedTime % 60;
    return '${hours.toString().padLeft(2, '0')}:'
           '${minutes.toString().padLeft(2, '0')}:'
           '${seconds.toString().padLeft(2, '0')}';
  }
}
```

## 3. Provider State Management

### Timer Provider
```dart
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class TimerProvider with ChangeNotifier {
  final Map<String, TimerModel> _timers = {};
  final WebSocketService _webSocketService = WebSocketService();
  
  Map<String, TimerModel> get timers => _timers;
  
  TimerProvider() {
    _setupWebSocket();
  }

  void _setupWebSocket() {
    _webSocketService.onDeviceDisconnect = _handleDeviceDisconnect;
    _webSocketService.onTimerDisconnect = _handleTimerDisconnect;
    _webSocketService.onError = _handleError;
    _webSocketService.connect();
  }

  void _handleDeviceDisconnect(Map<String, dynamic> data) {
    final deviceId = data['deviceId'];
    print('Device $deviceId disconnected at ${data['timestamp']}');
    
    // Update UI untuk menampilkan device offline
    _updateDeviceStatus(deviceId, 'offline');
  }

  void _handleTimerDisconnect(Map<String, dynamic> data) {
    final timerModel = TimerModel.fromJson(data);
    print('Timer for device ${timerModel.deviceId} disconnected');
    print('Elapsed time: ${timerModel.elapsedTime} seconds');
    
    // Update timer dengan waktu yang akurat
    _timers[timerModel.deviceId] = timerModel;
    notifyListeners();
    
    // Show notification
    _showDisconnectNotification(timerModel);
    
    // Update billing
    _updateBilling(timerModel);
  }

  void _handleError(String error) {
    print('WebSocket error: $error');
    // Show error notification to user
  }

  void _updateDeviceStatus(String deviceId, String status) {
    // Update device status in UI
    notifyListeners();
  }

  void _showDisconnectNotification(TimerModel timer) {
    // Show local notification
    FlutterLocalNotificationsPlugin().show(
      0,
      'Device Disconnected',
      'Device ${timer.deviceId} disconnected. Timer stopped at ${timer.formattedTime}',
      NotificationDetails(
        android: AndroidNotificationDetails(
          'timer_channel',
          'Timer Notifications',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }

  void _updateBilling(TimerModel timer) {
    // Update billing calculation with accurate time
    if (timer.transactionId != null) {
      // Call billing API with elapsed time
      _updateTransactionBilling(timer.transactionId!, timer.elapsedTime);
    }
  }

  Future<void> _updateTransactionBilling(String transactionId, int elapsedTime) async {
    // Implement billing update logic
  }

  @override
  void dispose() {
    _webSocketService.disconnect();
    super.dispose();
  }
}
```

## 4. UI Implementation

### Timer Widget
```dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

class TimerWidget extends StatelessWidget {
  final String deviceId;

  const TimerWidget({Key? key, required this.deviceId}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Consumer<TimerProvider>(
      builder: (context, timerProvider, child) {
        final timer = timerProvider.timers[deviceId];
        
        if (timer == null) {
          return _buildOfflineWidget();
        }

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Device: $deviceId',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    _buildStatusChip(timer.status),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  timer.formattedTime,
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontFamily: 'monospace',
                    fontWeight: FontWeight.bold,
                  ),
                ),
                if (timer.disconnectTime != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8.0),
                    child: Text(
                      'Disconnected: ${DateFormat('HH:mm:ss').format(timer.disconnectTime!)}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: Colors.red,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildStatusChip(String status) {
    Color color;
    String text;
    
    switch (status) {
      case 'on':
        color = Colors.green;
        text = 'Running';
        break;
      case 'disconnected':
        color = Colors.red;
        text = 'Disconnected';
        break;
      case 'pause':
        color = Colors.orange;
        text = 'Paused';
        break;
      default:
        color = Colors.grey;
        text = 'Offline';
    }

    return Chip(
      label: Text(text),
      backgroundColor: color.withOpacity(0.2),
      labelStyle: TextStyle(color: color),
    );
  }

  Widget _buildOfflineWidget() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Text(
              'Device: $deviceId',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Chip(
              label: Text('Offline'),
              backgroundColor: Colors.grey.withOpacity(0.2),
              labelStyle: TextStyle(color: Colors.grey),
            ),
          ],
        ),
      ),
    );
  }
}
```

### Main App
```dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

void main() {
  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (context) => TimerProvider(),
      child: MaterialApp(
        title: 'IoT Timer App',
        theme: ThemeData(
          primarySwatch: Colors.blue,
        ),
        home: TimerListScreen(),
      ),
    );
  }
}

class TimerListScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('IoT Timers'),
        actions: [
          Consumer<TimerProvider>(
            builder: (context, timerProvider, child) {
              return IconButton(
                icon: Icon(
                  timerProvider._webSocketService.isConnected 
                      ? Icons.wifi 
                      : Icons.wifi_off,
                ),
                onPressed: () {
                  // Show connection status
                },
              );
            },
          ),
        ],
      ),
      body: Consumer<TimerProvider>(
        builder: (context, timerProvider, child) {
          final timers = timerProvider.timers;
          
          if (timers.isEmpty) {
            return Center(
              child: Text('No active timers'),
            );
          }

          return ListView.builder(
            padding: EdgeInsets.all(16),
            itemCount: timers.length,
            itemBuilder: (context, index) {
              final deviceId = timers.keys.elementAt(index);
              return Padding(
                padding: EdgeInsets.only(bottom: 16),
                child: TimerWidget(deviceId: deviceId),
              );
            },
          );
        },
      ),
    );
  }
}
```

## 5. API Service

### HTTP Service
```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class ApiService {
  static const String baseUrl = 'http://localhost:3000/api';

  static Future<Map<String, dynamic>> getConnectionStatus() async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/connection/status'));
      
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      } else {
        throw Exception('Failed to get connection status');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }

  static Future<Map<String, dynamic>> getDeviceDetails(String deviceId) async {
    try {
      final response = await http.get(Uri.parse('$baseUrl/device/$deviceId'));
      
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      } else {
        throw Exception('Failed to get device details');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }

  static Future<void> updateTransactionBilling(String transactionId, int elapsedTime) async {
    try {
      final response = await http.put(
        Uri.parse('$baseUrl/transaction/$transactionId'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'elapsedTime': elapsedTime,
          'status': 'disconnected',
        }),
      );
      
      if (response.statusCode != 200) {
        throw Exception('Failed to update billing');
      }
    } catch (e) {
      throw Exception('Network error: $e');
    }
  }
}
```

## 6. Local Notifications Setup

### Notification Service
```dart
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

class NotificationService {
  static final FlutterLocalNotificationsPlugin _notifications = 
      FlutterLocalNotificationsPlugin();

  static Future<void> initialize() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings();
    
    const initSettings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );

    await _notifications.initialize(initSettings);

    // Create notification channel for Android
    const androidChannel = AndroidNotificationChannel(
      'timer_channel',
      'Timer Notifications',
      importance: Importance.high,
    );

    await _notifications
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(androidChannel);
  }

  static Future<void> showDisconnectNotification(String deviceId, String time) async {
    await _notifications.show(
      0,
      'Device Disconnected',
      'Device $deviceId disconnected. Timer stopped at $time',
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'timer_channel',
          'Timer Notifications',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }
}
```

## 7. Error Handling & Reconnection

### Connection Manager
```dart
class ConnectionManager {
  static final ConnectionManager _instance = ConnectionManager._internal();
  factory ConnectionManager() => _instance;
  ConnectionManager._internal();

  bool _isConnected = false;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  final int _maxReconnectAttempts = 5;

  bool get isConnected => _isConnected;

  void setConnected(bool connected) {
    _isConnected = connected;
    if (!connected) {
      _scheduleReconnect();
    } else {
      _reconnectAttempts = 0;
      _reconnectTimer?.cancel();
    }
  }

  void _scheduleReconnect() {
    if (_reconnectAttempts < _maxReconnectAttempts) {
      _reconnectAttempts++;
      final delay = (1000 * pow(2, _reconnectAttempts)).clamp(1000, 30000);
      
      _reconnectTimer = Timer(Duration(milliseconds: delay), () {
        print('Attempting to reconnect (${_reconnectAttempts}/${_maxReconnectAttempts})');
        // Trigger reconnection
      });
    }
  }

  void dispose() {
    _reconnectTimer?.cancel();
  }
}
```

## 8. Testing

### Test Disconnect Scenario
1. Start timer pada device IoT
2. Disconnect IoT device (unplug power/network)
3. Verify Flutter app receives notification within 1 second
4. Verify timer stops with accurate elapsed time
5. Verify billing calculation is updated correctly

### Debug Commands
```dart
// Enable debug logging
void enableDebugLogging() {
  if (kDebugMode) {
    print('Debug mode enabled');
  }
}

// Test WebSocket connection
void testWebSocketConnection() {
  final wsService = WebSocketService();
  wsService.onConnectionEstablished = () {
    print('WebSocket connected successfully');
  };
  wsService.connect();
}
```

## 9. Best Practices

1. **Always implement reconnection logic with exponential backoff**
2. **Show user-friendly notifications using flutter_local_notifications**
3. **Update UI immediately when disconnect detected**
4. **Store timer state locally using SharedPreferences for offline scenarios**
5. **Use Provider for state management**
6. **Log all connection events for debugging**
7. **Handle different screen orientations and sizes**
8. **Implement proper error boundaries** 