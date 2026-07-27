import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';

class StaffPerformanceScreen extends StatefulWidget {
  const StaffPerformanceScreen({super.key});

  @override
  State<StaffPerformanceScreen> createState() => _StaffPerformanceScreenState();
}

class _StaffPerformanceScreenState extends State<StaffPerformanceScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AdminService>().loadStaffPerformance());
  }

  @override
  Widget build(BuildContext context) {
    final admin = context.watch<AdminService>();
    final fmt = NumberFormat.currency(locale: 'tr_TR', symbol: '₺');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Pompacı Analizi'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => admin.loadStaffPerformance(),
          ),
        ],
      ),
      body: admin.loading
          ? const Center(child: CircularProgressIndicator())
          : admin.staffPerformance.isEmpty
              ? const Center(child: Text('Veri yok'))
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: admin.staffPerformance.length,
                  itemBuilder: (context, i) {
                    final s = admin.staffPerformance[i];
                    final rank = i + 1;
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                CircleAvatar(child: Text('$rank')),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    s.name,
                                    style: Theme.of(context).textTheme.titleMedium,
                                  ),
                                ),
                                if (s.suspiciousCount > 0)
                                  Chip(
                                    label: Text('${s.suspiciousCount} şüpheli'),
                                    backgroundColor: Colors.orange.shade100,
                                  ),
                              ],
                            ),
                            const Divider(),
                            _Row('İşlem sayısı', '${s.transactionCount}'),
                            _Row('Toplam ciro', fmt.format(s.totalAmount)),
                            _Row('Ortalama işlem', fmt.format(s.averageAmount)),
                            _Row('Şüpheli oranı', '%${s.suspiciousRate}'),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;

  const _Row(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: Theme.of(context).textTheme.bodyMedium),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}
