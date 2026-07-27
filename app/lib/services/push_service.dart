import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../core/api_client.dart';
import '../core/navigator.dart';
import '../screens/suspicious_screen.dart';

/// Arka planda bildirim almak için (iOS/Android)
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

class PushService {
  final ApiClient api;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  PushService(this.api);

  void _navigateToSuspicious() {
    navigatorKey.currentState?.push(
      MaterialPageRoute(builder: (_) => const SuspiciousScreen()),
    );
  }

  Future<void> init() async {
    if (kIsWeb || (!Platform.isIOS && !Platform.isAndroid)) return;

    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);

      const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosSettings = DarwinInitializationSettings(
        requestAlertPermission: false,
        requestBadgePermission: false,
        requestSoundPermission: false,
      );
      await _localNotifications.initialize(
        const InitializationSettings(android: androidSettings, iOS: iosSettings),
      );

      FirebaseMessaging.onMessage.listen(_showForegroundNotification);
      FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);

      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _handleNotificationTap(initial);
    } catch (e) {
      debugPrint('Firebase init hatası: $e');
    }
  }

  Future<void> registerForAdmin() async {
    if (kIsWeb || (!Platform.isIOS && !Platform.isAndroid)) return;

    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      if (settings.authorizationStatus == AuthorizationStatus.denied) return;

      if (Platform.isIOS) {
        await messaging.setForegroundNotificationPresentationOptions(
          alert: true,
          badge: true,
          sound: true,
        );
      }

      final token = await messaging.getToken();
      if (token == null) return;

      await api.post('/notifications/devices', {
        'token': token,
        'platform': Platform.isIOS ? 'ios' : 'android',
      });

      messaging.onTokenRefresh.listen((newToken) async {
        await api.post('/notifications/devices', {
          'token': newToken,
          'platform': Platform.isIOS ? 'ios' : 'android',
        });
      });
    } catch (e) {
      debugPrint('Push kayıt hatası: $e');
    }
  }

  Future<void> unregister() async {
    if (kIsWeb || (!Platform.isIOS && !Platform.isAndroid)) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) {
        await api.delete('/notifications/devices', {'token': token});
      }
    } catch (_) {}
  }

  void _showForegroundNotification(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;

    _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      const NotificationDetails(
        iOS: DarwinNotificationDetails(presentAlert: true, presentSound: true),
        android: AndroidNotificationDetails(
          'suspicious_channel',
          'Şüpheli İşlemler',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }

  void _handleNotificationTap(RemoteMessage message) {
    final type = message.data['type'];
    if (type == 'suspicious_transaction' || type == 'test') {
      _navigateToSuspicious();
    }
  }
}
