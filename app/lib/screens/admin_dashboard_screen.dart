import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AdminService>().loadDashboard());
  }

  @override
  Widget build(BuildContext context) {
    final admin = context.watch<AdminService>();
    final fmt = NumberFormat.currency(locale: 'tr_TR', symbol: '₺');
    final d = admin.dashboard;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Yönetici Paneli'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => admin.loadDashboard(),
          ),
        ],
      ),
      body: admin.loading && d == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _StatCard(
                  title: 'Bugünkü İşlem',
                  value: '${d?['today']?['transactionCount'] ?? 0}',
                  icon: Icons.receipt,
                ),
                _StatCard(
                  title: 'Bugünkü Toplam',
                  value: fmt.format((d?['today']?['totalAmount'] as num?) ?? 0),
                  icon: Icons.payments,
                ),
                _StatCard(
                  title: 'Şüpheli İşlem',
                  value: '${d?['suspiciousCount'] ?? 0}',
                  icon: Icons.warning,
                  color: Colors.orange.shade50,
                ),
                _StatCard(
                  title: 'Onay Bekleyen Düzeltme',
                  value: '${d?['pendingCorrections'] ?? 0}',
                  icon: Icons.pending_actions,
                  color: Colors.blue.shade50,
                ),
              ],
            ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final String value;
  final IconData icon;
  final Color? color;

  const _StatCard({
    required this.title,
    required this.value,
    required this.icon,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: color,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            Icon(icon, size: 40),
            const SizedBox(width: 16),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.bodyMedium),
                Text(value, style: Theme.of(context).textTheme.headlineSmall),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
