import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/services.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<dynamic> notifications = [];
  bool loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => loading = true);
    try {
      final api = context.read<AuthService>().api;
      final data = await api.get('/notifications');
      setState(() {
        notifications = data['notifications'] as List;
        loading = false;
      });
    } catch (e) {
      setState(() => loading = false);
    }
  }

  Future<void> _testPush() async {
    try {
      final api = context.read<AuthService>().api;
      final data = await api.post('/notifications/test', {});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(data['message'] as String? ?? 'Gönderildi')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Bildirimler'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          IconButton(
            icon: const Icon(Icons.notifications_active),
            onPressed: _testPush,
            tooltip: 'Test bildirimi',
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : notifications.isEmpty
              ? const Center(child: Text('Henüz bildirim yok'))
              : ListView.builder(
                  itemCount: notifications.length,
                  itemBuilder: (context, i) {
                    final n = notifications[i] as Map<String, dynamic>;
                    final isRead = n['isRead'] as bool? ?? false;
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      color: isRead ? null : Colors.orange.shade50,
                      child: ListTile(
                        leading: Icon(
                          Icons.warning_amber,
                          color: isRead ? Colors.grey : Colors.orange,
                        ),
                        title: Text(
                          n['title'] as String? ?? '',
                          style: TextStyle(
                            fontWeight: isRead ? FontWeight.normal : FontWeight.bold,
                          ),
                        ),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(n['body'] as String? ?? ''),
                            const SizedBox(height: 4),
                            Text(
                              n['createdAt'] as String? ?? '',
                              style: const TextStyle(fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
