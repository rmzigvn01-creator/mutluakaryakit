import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

class AppConfig {
  // Windows emülatör/cihaz için localhost
  // iOS simülatör: localhost
  // Gerçek cihaz: bilgisayarın IP adresi
  static const String apiBaseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://localhost:3001',
  );

  static String get apiUrl => '$apiBaseUrl/api';

  static Future<void> initDatabaseFactory() async {
    if (!kIsWeb && (Platform.isWindows || Platform.isLinux)) {
      sqfliteFfiInit();
      databaseFactory = databaseFactoryFfi;
    }
  }
}
