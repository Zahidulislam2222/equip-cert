/// The asset register, ordered by what is most overdue.
///
/// Ordering is the whole feature. A list sorted by name is an inventory; a list sorted by
/// due date is a work queue, and a technician arriving on site needs the second one. The
/// server already returns `next_due_date` ascending, and overdue items are grouped ahead of
/// the rest here so the two most urgent categories cannot be scrolled past.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_widgets.dart';
import 'home_screen.dart' show EquipmentTile, equipmentDueProvider;

class EquipmentScreen extends ConsumerStatefulWidget {
  const EquipmentScreen({super.key});

  @override
  ConsumerState<EquipmentScreen> createState() => _EquipmentScreenState();
}

class _EquipmentScreenState extends ConsumerState<EquipmentScreen> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppColors c = colorsOf(context);
    final AsyncValue<List<Equipment>> equipment = ref.watch(
      equipmentDueProvider(200),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Equipment')),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: AppTextField(
                label: 'Search',
                controller: _search,
                hint: 'Name, location or serial number',
                autocorrect: false,
                // Filtering happens on the loaded list rather than as a query. The register
                // is small enough to hold (the query caps at 200) and a per-keystroke round
                // trip is unusable on the connection this app is designed for.
                onSubmitted: (_) => setState(() {}),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                color: c.primary,
                backgroundColor: c.elevated,
                onRefresh: () async => ref.invalidate(equipmentDueProvider),
                child: equipment.when(
                  loading: () => const LoadingState(),
                  error: (Object error, StackTrace _) => ListView(
                    children: const <Widget>[
                      SizedBox(height: 80),
                      ErrorState(
                        message: 'Could not load the equipment register.',
                      ),
                    ],
                  ),
                  data: (List<Equipment> all) => _List(
                    equipment: _filter(all, _search.text),
                    query: _search.text.trim(),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  static List<Equipment> _filter(List<Equipment> all, String query) {
    final String needle = query.trim().toLowerCase();
    if (needle.isEmpty) return all;

    return all
        .where(
          (Equipment e) =>
              e.name.toLowerCase().contains(needle) ||
              (e.location?.toLowerCase().contains(needle) ?? false) ||
              (e.serialNumber?.toLowerCase().contains(needle) ?? false),
        )
        .toList(growable: false);
  }
}

class _List extends StatelessWidget {
  const _List({required this.equipment, required this.query});

  final List<Equipment> equipment;
  final String query;

  @override
  Widget build(BuildContext context) {
    if (equipment.isEmpty) {
      return ListView(
        children: <Widget>[
          const SizedBox(height: 60),
          EmptyState(
            icon: query.isEmpty
                ? Icons.inventory_2_outlined
                : Icons.search_off_rounded,
            title: query.isEmpty ? 'No equipment' : 'Nothing matches',
            message: query.isEmpty
                ? 'No active equipment is registered to your organisation.'
                : 'No active equipment matches "$query".',
          ),
        ],
      );
    }

    final List<Equipment> overdue = equipment
        .where((Equipment e) => e.isOverdue)
        .toList(growable: false);
    final List<Equipment> today = equipment
        .where((Equipment e) => !e.isOverdue && e.isDueToday)
        .toList(growable: false);
    final List<Equipment> rest = equipment
        .where((Equipment e) => !e.isOverdue && !e.isDueToday)
        .toList(growable: false);

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
      children: <Widget>[
        if (overdue.isNotEmpty) ..._group(context, 'Overdue', overdue),
        if (today.isNotEmpty) ..._group(context, 'Due today', today),
        if (rest.isNotEmpty) ..._group(context, 'Scheduled', rest),
      ],
    );
  }

  List<Widget> _group(
    BuildContext context,
    String title,
    List<Equipment> rows,
  ) {
    final AppColors c = colorsOf(context);

    return <Widget>[
      Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 10),
        child: Text(
          '$title (${rows.length})',
          style: Theme.of(context).textTheme.titleSmall
              ?.copyWith(color: c.mutedForeground),
        ),
      ),
      for (final Equipment item in rows)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: EquipmentTile(equipment: item),
        ),
    ];
  }
}
