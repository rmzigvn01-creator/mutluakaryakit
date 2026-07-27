import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/services.dart';

class TransactionListScreen extends StatefulWidget {
  const TransactionListScreen({super.key});

  @override
  State<TransactionListScreen> createState() => _TransactionListScreenState();
}

class _TransactionListScreenState extends State<TransactionListScreen> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => context.read<TransactionService>().loadTransactions());
  }

  @override
  Widget build(BuildContext context) {
    final tx = context.watch<TransactionService>();
    final fmt = NumberFormat.currency(locale: 'tr_TR', symbol: '₺');
    final dateFmt = DateFormat('dd.MM.yyyy HH:mm');

    return Scaffold(
      appBar: AppBar(
        title: const Text('İşlemler'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () => tx.loadTransactions(),
          ),
        ],
      ),
      body: tx.loading
          ? const Center(child: CircularProgressIndicator())
          : tx.transactions.isEmpty
              ? const Center(child: Text('Henüz işlem yok'))
              : ListView.builder(
                  itemCount: tx.transactions.length,
                  itemBuilder: (context, i) {
                    final t = tx.transactions[i];
                    return _TransactionTile(transaction: t, fmt: fmt, dateFmt: dateFmt);
                  },
                ),
    );
  }
}

class _TransactionTile extends StatelessWidget {
  final TransactionModel transaction;
  final NumberFormat fmt;
  final DateFormat dateFmt;

  const _TransactionTile({
    required this.transaction,
    required this.fmt,
    required this.dateFmt,
  });

  @override
  Widget build(BuildContext context) {
    final t = transaction;
    final suspicious = t.isSuspicious;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: suspicious ? Colors.orange : Colors.green.shade100,
          child: Icon(
            suspicious ? Icons.warning : Icons.check,
            color: suspicious ? Colors.orange.shade900 : Colors.green.shade800,
          ),
        ),
        title: Text('${t.typeLabel} — ${fmt.format(t.enteredAmount)}'),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(dateFmt.format(DateTime.parse(t.createdAt))),
            if (t.createdByName != null) Text('Pompacı: ${t.createdByName}'),
            if (context.watch<AuthService>().user?.isAdmin == true && t.receiptAmount != null)
              Text('Fiş tutarı: ${fmt.format(t.receiptAmount)}'),
            if (context.watch<AuthService>().user?.isAdmin == true && suspicious)
              Text(
                t.suspicionLabel,
                style: TextStyle(color: Colors.orange.shade800, fontWeight: FontWeight.bold),
              ),
          ],
        ),
        isThreeLine: true,
      ),
    );
  }
}
