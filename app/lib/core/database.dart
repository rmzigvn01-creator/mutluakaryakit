import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class LocalDatabase {
  static Database? _db;

  static Future<Database> get instance async {
    _db ??= await _init();
    return _db!;
  }

  static Future<Database> _init() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'mutluakaryakit.db');

    return openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE pending_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_id TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL,
            entered_amount REAL NOT NULL,
            description TEXT,
            receipt_path TEXT NOT NULL,
            device_info TEXT,
            created_at TEXT NOT NULL,
            sync_status TEXT NOT NULL DEFAULT 'pending'
          )
        ''');
        await db.execute('''
          CREATE TABLE cached_transactions (
            id TEXT PRIMARY KEY,
            client_id TEXT,
            type TEXT NOT NULL,
            entered_amount REAL NOT NULL,
            receipt_amount REAL,
            amount_diff REAL,
            description TEXT,
            suspicion_status TEXT NOT NULL,
            created_by_name TEXT,
            created_at TEXT NOT NULL,
            sync_status TEXT NOT NULL,
            raw_json TEXT NOT NULL
          )
        ''');
      },
    );
  }

  static Future<int> insertPending({
    required String clientId,
    required String type,
    required double enteredAmount,
    String? description,
    required String receiptPath,
    String? deviceInfo,
    required String createdAt,
  }) async {
    final db = await instance;
    return db.insert('pending_transactions', {
      'client_id': clientId,
      'type': type,
      'entered_amount': enteredAmount,
      'description': description,
      'receipt_path': receiptPath,
      'device_info': deviceInfo,
      'created_at': createdAt,
      'sync_status': 'pending',
    });
  }

  static Future<List<Map<String, dynamic>>> getPending() async {
    final db = await instance;
    return db.query(
      'pending_transactions',
      where: 'sync_status = ?',
      whereArgs: ['pending'],
      orderBy: 'created_at ASC',
    );
  }

  static Future<void> markSynced(String clientId) async {
    final db = await instance;
    await db.update(
      'pending_transactions',
      {'sync_status': 'synced'},
      where: 'client_id = ?',
      whereArgs: [clientId],
    );
  }

  static Future<int> pendingCount() async {
    final db = await instance;
    final result = await db.rawQuery(
      "SELECT COUNT(*) as c FROM pending_transactions WHERE sync_status = 'pending'",
    );
    return Sqflite.firstIntValue(result) ?? 0;
  }
}
