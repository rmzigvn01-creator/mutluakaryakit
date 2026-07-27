import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import '../core/api_client.dart';
import '../core/database.dart';
import '../models/models.dart';
import 'push_service.dart';

class AuthService extends ChangeNotifier {
  final ApiClient api;
  PushService? push;
  UserModel? user;
  bool loading = false;
  String? error;

  AuthService(this.api);

  bool get isLoggedIn => user != null;

  Future<void> tryRestoreSession() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('token');
    if (token == null) return;

    api.setToken(token);
    try {
      final res = await api.get('/auth/me');
      user = UserModel.fromJson(res);
      notifyListeners();
      if (user!.isAdmin) await push?.registerForAdmin();
    } catch (_) {
      await logout();
    }
  }

  Future<bool> login(String email, String password) async {
    loading = true;
    error = null;
    notifyListeners();

    try {
      final res = await api.post('/auth/login', {
        'email': email.trim(),
        'password': password,
      });
      final token = res['token'] as String;
      api.setToken(token);
      user = UserModel.fromJson(res['user'] as Map<String, dynamic>);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('token', token);
      loading = false;
      notifyListeners();
      if (user!.isAdmin) await push?.registerForAdmin();
      return true;
    } on ApiException catch (e) {
      error = e.message;
      loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    await push?.unregister();
    api.setToken(null);
    user = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('token');
    notifyListeners();
  }
}

class TransactionService extends ChangeNotifier {
  final ApiClient api;
  List<TransactionModel> transactions = [];
  bool loading = false;
  String? error;
  int pendingSyncCount = 0;

  TransactionService(this.api);

  Future<void> refreshPendingCount() async {
    pendingSyncCount = await LocalDatabase.pendingCount();
    notifyListeners();
  }

  Future<void> loadTransactions({String? suspicionStatus}) async {
    loading = true;
    error = null;
    notifyListeners();

    try {
      final query = <String, String>{'limit': '100'};
      if (suspicionStatus != null) query['suspicionStatus'] = suspicionStatus;

      final res = await api.get('/transactions', query: query);
      final list = (res['transactions'] as List)
          .map((e) => TransactionModel.fromJson(e as Map<String, dynamic>))
          .toList();
      transactions = list;
      loading = false;
      notifyListeners();
    } on ApiException catch (e) {
      error = e.message;
      loading = false;
      notifyListeners();
    }
  }

  Future<bool> createTransaction({
    required String type,
    required double enteredAmount,
    String? description,
    required String receiptPath,
    bool offline = false,
  }) async {
    final clientId = _uuid();
    final createdAt = DateTime.now().toIso8601String();

    if (offline) {
      await LocalDatabase.insertPending(
        clientId: clientId,
        type: type,
        enteredAmount: enteredAmount,
        description: description,
        receiptPath: receiptPath,
        deviceInfo: defaultTargetPlatform.name,
        createdAt: createdAt,
      );
      await refreshPendingCount();
      return true;
    }

    try {
      await api.postMultipart('/transactions', {
        'type': type,
        'enteredAmount': enteredAmount.toString(),
        if (description != null) 'description': description,
        'clientId': clientId,
        'deviceInfo': defaultTargetPlatform.name,
        'createdAt': createdAt,
      }, 'receipt', receiptPath);
      await loadTransactions();
      return true;
    } on ApiException catch (e) {
      error = e.message;
      notifyListeners();
      return false;
    }
  }

  Future<int> syncPending() async {
    final pending = await LocalDatabase.getPending();
    var synced = 0;

    for (final row in pending) {
      try {
        await api.postMultipart('/transactions', {
          'type': row['type'] as String,
          'enteredAmount': (row['entered_amount'] as num).toString(),
          if (row['description'] != null) 'description': row['description'] as String,
          'clientId': row['client_id'] as String,
          if (row['device_info'] != null) 'deviceInfo': row['device_info'] as String,
          'createdAt': row['created_at'] as String,
        }, 'receipt', row['receipt_path'] as String);

        await LocalDatabase.markSynced(row['client_id'] as String);
        synced++;
      } catch (_) {
        // Sonraki denemede tekrar dener
      }
    }

    await refreshPendingCount();
    if (synced > 0) await loadTransactions();
    return synced;
  }

  String _uuid() => const Uuid().v4();
}

class AdminService extends ChangeNotifier {
  final ApiClient api;
  Map<String, dynamic>? dashboard;
  List<TransactionModel> suspicious = [];
  List<StaffPerformance> staffPerformance = [];
  bool loading = false;

  AdminService(this.api);

  Future<void> loadDashboard() async {
    loading = true;
    notifyListeners();
    try {
      dashboard = await api.get('/admin/dashboard');
    } catch (_) {}
    loading = false;
    notifyListeners();
  }

  Future<void> loadSuspicious() async {
    loading = true;
    notifyListeners();
    try {
      final res = await api.get('/admin/suspicious');
      suspicious = (res['transactions'] as List)
          .map((e) => TransactionModel.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {}
    loading = false;
    notifyListeners();
  }

  Future<void> reviewSuspicious(String id, {String? note}) async {
    await api.post('/admin/suspicious/$id/review', {'note': note});
    await loadSuspicious();
    await loadDashboard();
  }

  Future<void> loadStaffPerformance() async {
    loading = true;
    notifyListeners();
    try {
      final res = await api.get('/reports/staff-performance');
      staffPerformance = (res['staff'] as List)
          .map((e) => StaffPerformance.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {}
    loading = false;
    notifyListeners();
  }
}

class SyncService extends ChangeNotifier {
  final TransactionService transactionService;
  bool syncing = false;
  String? lastMessage;

  SyncService(this.transactionService);

  Future<void> syncIfOnline(bool isOnline) async {
    if (!isOnline || syncing) return;
    syncing = true;
    notifyListeners();

    final count = await transactionService.syncPending();
    lastMessage = count > 0 ? '$count kayıt senkronize edildi' : null;
    syncing = false;
    notifyListeners();
  }
}
