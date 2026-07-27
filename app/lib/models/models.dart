class UserModel {
  final String id;
  final String email;
  final String name;
  final String role;
  final String stationId;
  final String? stationName;

  UserModel({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.stationId,
    this.stationName,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id'] as String,
      email: json['email'] as String,
      name: json['name'] as String,
      role: json['role'] as String,
      stationId: json['stationId'] as String,
      stationName: json['stationName'] as String?,
    );
  }

  bool get isAdmin => role == 'ADMIN';
  bool get isStaff => role == 'STAFF';
  bool get isAccountant => role == 'ACCOUNTANT';
}

class TransactionModel {
  final String id;
  final String clientId;
  final String type;
  final double enteredAmount;
  final double? receiptAmount;
  final double? amountDiff;
  final String? description;
  final String suspicionStatus;
  final String? createdByName;
  final String createdAt;
  final String syncStatus;

  TransactionModel({
    required this.id,
    required this.clientId,
    required this.type,
    required this.enteredAmount,
    this.receiptAmount,
    this.amountDiff,
    this.description,
    required this.suspicionStatus,
    this.createdByName,
    required this.createdAt,
    this.syncStatus = 'SYNCED',
  });

  factory TransactionModel.fromJson(Map<String, dynamic> json) {
    final createdBy = json['createdBy'] as Map<String, dynamic>?;
    return TransactionModel(
      id: json['id'] as String,
      clientId: json['clientId'] as String,
      type: json['type'] as String,
      enteredAmount: (json['enteredAmount'] as num).toDouble(),
      receiptAmount: json['receiptAmount'] != null
          ? (json['receiptAmount'] as num).toDouble()
          : null,
      amountDiff: json['amountDiff'] != null
          ? (json['amountDiff'] as num).toDouble()
          : null,
      description: json['description'] as String?,
      suspicionStatus: json['suspicionStatus'] as String,
      createdByName: createdBy?['name'] as String?,
      createdAt: json['createdAt'] as String,
      syncStatus: json['syncStatus'] as String? ?? 'SYNCED',
    );
  }

  bool get isSuspicious =>
      suspicionStatus == 'SUSPICIOUS_MISMATCH' ||
      suspicionStatus == 'SUSPICIOUS_UNREADABLE' ||
      suspicionStatus == 'PENDING_OCR';

  String get typeLabel {
    switch (type) {
      case 'FUEL_BENZIN':
        return 'Benzin';
      case 'FUEL_MOTORIN':
        return 'Motorin';
      case 'CARD_POS':
        return 'Kart (POS)';
      case 'CASH':
        return 'Nakit';
      default:
        return 'Diğer';
    }
  }

  String get suspicionLabel {
    switch (suspicionStatus) {
      case 'NORMAL':
        return 'Normal';
      case 'SUSPICIOUS_MISMATCH':
        return 'Tutarsızlık';
      case 'SUSPICIOUS_UNREADABLE':
        return 'Fiş okunamadı';
      case 'PENDING_OCR':
        return 'OCR bekliyor';
      case 'REVIEWED':
        return 'İncelendi';
      default:
        return suspicionStatus;
    }
  }
}

class StaffPerformance {
  final String name;
  final int transactionCount;
  final double totalAmount;
  final double averageAmount;
  final int suspiciousCount;
  final double suspiciousRate;

  StaffPerformance({
    required this.name,
    required this.transactionCount,
    required this.totalAmount,
    required this.averageAmount,
    required this.suspiciousCount,
    required this.suspiciousRate,
  });

  factory StaffPerformance.fromJson(Map<String, dynamic> json) {
    final staff = json['staff'] as Map<String, dynamic>;
    return StaffPerformance(
      name: staff['name'] as String,
      transactionCount: json['transactionCount'] as int,
      totalAmount: (json['totalAmount'] as num).toDouble(),
      averageAmount: (json['averageAmount'] as num).toDouble(),
      suspiciousCount: json['suspiciousCount'] as int,
      suspiciousRate: (json['suspiciousRate'] as num).toDouble(),
    );
  }
}
