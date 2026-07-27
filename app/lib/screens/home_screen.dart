import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';
import 'new_transaction_screen.dart';
import 'transaction_list_screen.dart';
import 'admin_dashboard_screen.dart';
import 'suspicious_screen.dart';
import 'staff_performance_screen.dart';
import 'notifications_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(_init);
  }

  Future<void> _init() async {
    await context.read<TransactionService>().refreshPendingCount();
    _trySync();
    Connectivity().onConnectivityChanged.listen((_) => _trySync());
  }

  Future<void> _trySync() async {
    final result = await Connectivity().checkConnectivity();
    final online = !result.contains(ConnectivityResult.none);
    if (online && mounted) {
      await context.read<SyncService>().syncIfOnline(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final tx = context.watch<TransactionService>();
    final user = auth.user!;

    return Scaffold(
      appBar: AppBar(
        title: Text('Merhaba, ${user.name}'),
        actions: [
          if (tx.pendingSyncCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Chip(
                label: Text('${tx.pendingSyncCount} bekliyor'),
                avatar: const Icon(Icons.cloud_upload, size: 16),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: _trySync,
            tooltip: 'Senkronize et',
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => auth.logout(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (user.isStaff || user.isAdmin) ...[
            _MenuCard(
              icon: Icons.add_circle,
              title: 'Yeni İşlem',
              subtitle: 'Fiş fotoğrafı zorunlu',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const NewTransactionScreen()),
              ),
            ),
            const SizedBox(height: 12),
          ],
          _MenuCard(
            icon: Icons.receipt_long,
            title: 'İşlem Listesi',
            subtitle: 'Tüm kayıtlar',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TransactionListScreen()),
            ),
          ),
          if (user.isAdmin) ...[
            const SizedBox(height: 12),
            _MenuCard(
              icon: Icons.notifications,
              title: 'Bildirimler',
              subtitle: 'Şüpheli işlem uyarıları',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const NotificationsScreen()),
              ),
            ),
            const SizedBox(height: 12),
            _MenuCard(
              icon: Icons.dashboard,
              title: 'Yönetici Paneli',
              subtitle: 'Günlük özet ve onaylar',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AdminDashboardScreen()),
              ),
            ),
            const SizedBox(height: 12),
            _MenuCard(
              icon: Icons.warning_amber,
              title: 'Şüpheli İşlemler',
              subtitle: 'Tutarsız fiş / tutar',
              color: Colors.orange.shade50,
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SuspiciousScreen()),
              ),
            ),
            const SizedBox(height: 12),
            _MenuCard(
              icon: Icons.people,
              title: 'Pompacı Analizi',
              subtitle: 'Ay sonu performans karşılaştırması',
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const StaffPerformanceScreen()),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _MenuCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final Color? color;

  const _MenuCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      child: ListTile(
        leading: Icon(icon, size: 32),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}
