import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';

class SuspiciousScreen extends StatefulWidget {
  const SuspiciousScreen({super.key});

  @override
  State<SuspiciousScreen> createState() => _SuspiciousScreenState();
}

class _SuspiciousScreenState extends State<SuspiciousScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<AdminService>().loadSuspicious());
  }

  Future<void> _review(String id) async {
    final note = await showDialog<String>(
      context: context,
      builder: (ctx) {
        final controller = TextEditingController();
        return AlertDialog(
          title: const Text('İşlemi İncele'),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(labelText: 'Not (isteğe bağlı)'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('İptal')),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, controller.text),
              child: const Text('İncelendi Olarak İşaretle'),
            ),
          ],
        );
      },
    );

    if (note != null && mounted) {
      await context.read<AdminService>().reviewSuspicious(id, note: note.isEmpty ? null : note);
    }
  }

  @override
  Widget build(BuildContext context) {
    final admin = context.watch<AdminService>();
    final fmt = NumberFormat.currency(locale: 'tr_TR', symbol: '₺');
    final dateFmt = DateFormat('dd.MM.yyyy HH:mm');

    return Scaffold(
      appBar: AppBar(
        title: const Text('Şüpheli İşlemler'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => admin.loadSuspicious(),
          ),
        ],
      ),
      body: admin.loading
          ? const Center(child: CircularProgressIndicator())
          : admin.suspicious.isEmpty
              ? const Center(child: Text('Şüpheli işlem yok'))
              : ListView.builder(
                  itemCount: admin.suspicious.length,
                  itemBuilder: (context, i) {
                    final t = admin.suspicious[i];
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      color: Colors.orange.shade50,
                      child: ListTile(
                        title: Text('${t.typeLabel} — ${fmt.format(t.enteredAmount)}'),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(dateFmt.format(DateTime.parse(t.createdAt))),
                            if (t.createdByName != null) Text('Pompacı: ${t.createdByName}'),
                            if (t.receiptAmount != null)
                              Text(
                                'Fiş: ${fmt.format(t.receiptAmount)} | Fark: ${fmt.format(t.amountDiff ?? 0)}',
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              )
                            else
                              Text(t.suspicionLabel),
                          ],
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.check_circle_outline),
                          onPressed: () => _review(t.id),
                          tooltip: 'İncelendi',
                        ),
                        isThreeLine: true,
                      ),
                    );
                  },
                ),
    );
  }
}
