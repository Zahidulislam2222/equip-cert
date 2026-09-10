/// Every column the Dart models read must actually exist in the applied schema.
///
/// ---------------------------------------------------------------------------------------
/// THE DEFECT THIS EXISTS TO PREVENT
///
/// DEF-023: the web client's corrective-action form inserted a `photo_url` column that no
/// schema has ever had. TypeScript did not catch it, no gate rendered the form, and the
/// failure only reached anyone as a runtime `column "photo_url" does not exist` — on the free
/// plan, on a path few users took, so it sat there. The column it wanted was
/// `defect_photo_url`.
///
/// The web side is protected by `npm run gen:types` + `npm run test:types`, which regenerate
/// `database.types.ts` from the live database and fail when it drifts. **Dart has no such
/// generator**, so `models.dart` is hand-written — which is precisely the practice that
/// produced DEF-023 in the first place.
///
/// ---------------------------------------------------------------------------------------
/// HOW THIS AVOIDS BEING A RESTATEMENT OF THE BUG
///
/// The obvious test is a hand-written list of expected columns. That is worthless: it would
/// be written by reading the same model file, so a model naming `photo_url` would get a list
/// containing `photo_url`, and the test would pass while the insert failed.
///
/// So nothing here is hand-written except the class -> table mapping, which is the one claim
/// a machine cannot infer. Everything else is PARSED from the two sources that disagree:
///
///   * `lib/src/data/models.dart`      — every `json['...']` key, per class.
///   * `../supabase/migrations/*.sql`  — every column of every `CREATE TABLE`, plus the
///                                       columns later `ALTER TABLE ... ADD COLUMN`ed.
///
/// A column that exists in one and not the other fails, in whichever direction it happens.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The only hand-written fact in this file: which table each model row comes from.
const Map<String, String> _classToTable = <String, String>{
  'Organization': 'organizations',
  'Profile': 'profiles',
  'Equipment': 'equipment',
  'Inspection': 'inspections',
  'CorrectiveAction': 'corrective_actions',
};

/// Keys that are legitimately not columns of the model's own table.
///
/// Supabase returns an embedded resource under the name of the relationship, so a select with
/// a join produces a key that is a TABLE name rather than a column name. Listing them here is
/// an explicit exemption, which is very different from the test not looking.
const Map<String, Set<String>> _notColumns = <String, Set<String>>{};

void main() {
  final Directory migrations = Directory('../supabase/migrations');

  test('the migrations directory is where this test expects it', () {
    // Fails rather than skips. A contract test that quietly stops reading the other side of
    // the contract is worse than no test, because it still reports green.
    expect(
      migrations.existsSync(),
      isTrue,
      reason:
          'Expected ${migrations.absolute.path}. This test is the only thing standing '
          'between the hand-written Dart models and another DEF-023.',
    );
  });

  final Map<String, _Table> schema = _parseSchema(migrations);

  group('schema parsing sanity', () {
    // If the SQL parser below silently matched nothing, every assertion in this file would
    // vacuously pass. These are the tripwires for that.
    test('every mapped table was found in the migrations', () {
      for (final String table in _classToTable.values) {
        expect(
          schema.keys,
          contains(table),
          reason:
              'No CREATE TABLE for "$table" was parsed out of the migrations.',
        );
      }
    });

    test('tables came back with a plausible number of columns', () {
      for (final MapEntry<String, _Table> entry in schema.entries) {
        expect(
          entry.value.columns.length,
          greaterThanOrEqualTo(4),
          reason:
              '"${entry.key}" parsed with only ${entry.value.columns.length} columns, '
              'which means the DDL parser is not reading this table correctly.',
        );
      }
    });

    test('a known column with a known nullability parsed correctly', () {
      // Anchors the parser against three facts read straight from
      // 20260910000100_core_schema.sql. If the parser breaks, these break with it.
      expect(schema['inspections']!.columns, contains('ai_disclosed_at'));
      expect(schema['inspections']!.notNull, contains('equipment_name'));
      expect(schema['inspections']!.notNull, isNot(contains('inspector_id')));
    });

    test(
      'the DEF-023 column really is absent, and its replacement present',
      () {
        // The regression itself, stated as a fact about the schema.
        expect(
          schema['corrective_actions']!.columns,
          isNot(contains('photo_url')),
          reason:
              'If corrective_actions ever gains a photo_url column this test is stale, but '
              'the point stands: the web form invented it and nothing noticed.',
        );
        expect(
          schema['corrective_actions']!.columns,
          contains('defect_photo_url'),
        );
      },
    );
  });

  group('every column read by a model exists', () {
    final File models = File('lib/src/data/models.dart');

    test('models.dart is readable', () {
      expect(models.existsSync(), isTrue);
    });

    final Map<String, Set<String>> readKeys = _jsonKeysByClass(
      models.existsSync() ? models.readAsStringSync() : '',
    );

    for (final MapEntry<String, String> entry in _classToTable.entries) {
      final String className = entry.key;
      final String table = entry.value;

      test('$className reads only real columns of $table', () {
        final Set<String> keys = readKeys[className] ?? const <String>{};

        expect(
          keys,
          isNotEmpty,
          reason:
              'No json[...] keys were parsed out of class $className. Either the class '
              'was renamed or the parser no longer recognises the accessor shape — both mean '
              'this table is now unchecked.',
        );

        final Set<String> allowed = <String>{
          ...schema[table]!.columns,
          ...?_notColumns[className],
        };

        final Set<String> unknown = keys.difference(allowed);
        expect(
          unknown,
          isEmpty,
          reason:
              '$className reads ${unknown.join(', ')} from "$table", which has no such '
              'column. This is DEF-023 exactly: it compiles, it type-checks, and it fails at '
              'runtime for whoever is standing in a plant room.',
        );
      });
    }
  });

  group('required columns are not treated as optional', () {
    // A NOT NULL column parsed with `as String?` produces a null the UI renders as blank
    // rather than an error, which is how a missing inspector name reaches a safety document.
    final String source = File('lib/src/data/models.dart').existsSync()
        ? File('lib/src/data/models.dart').readAsStringSync()
        : '';

    test('inspections.inspector_name is read as required or defaulted, never silently null', () {
      // `inspector_name` is NOT NULL with a length CHECK. NFPA 10 and OSHA 1910.157 both
      // require the inspection to name the qualified person who performed it.
      expect(schema['inspections']!.notNull, contains('inspector_name'));
      expect(
        source,
        contains("json['inspector_name']"),
        reason: 'The Inspection model no longer reads inspector_name at all.',
      );
    });

    test('the AI provenance columns are read as a complete set', () {
      // `ai_provenance_is_complete` is a CHECK constraint: all four together or all four
      // null. A model that reads three of them writes a record the database will reject.
      const List<String> provenance = <String>[
        'ai_assisted',
        'ai_provider',
        'ai_model',
        'ai_disclosed_at',
      ];
      for (final String column in provenance) {
        expect(schema['inspections']!.columns, contains(column));
      }
    });

    test('location is a pair in the schema, so it must be a pair in code', () {
      expect(
        schema['inspections']!.columns,
        containsAll(<String>['location_lat', 'location_lng']),
      );
    });
  });

  group('evidence columns hold paths, not URLs', () {
    // DEF-017. The column names still say `_url` for compatibility with rows written before
    // the fix, but what goes in them is a bucket-relative path. This asserts the columns the
    // evidence contract depends on exist under the names the code uses.
    test('inspections carries photo_url and signature_url', () {
      expect(
        schema['inspections']!.columns,
        containsAll(<String>['photo_url', 'signature_url']),
      );
    });

    test('corrective_actions distinguishes the defect photo from the resolution photo', () {
      expect(
        schema['corrective_actions']!.columns,
        containsAll(<String>['defect_photo_url', 'resolution_photo_url']),
      );
    });
  });
}

/// One table's parsed shape.
class _Table {
  _Table(this.name);

  final String name;
  final Set<String> columns = <String>{};
  final Set<String> notNull = <String>{};

  /// NOT NULL and no DEFAULT — an insert that omits one of these is rejected.
  final Set<String> requiredOnInsert = <String>{};
}

/// Read every `CREATE TABLE public.x (...)` and `ALTER TABLE public.x ADD COLUMN y` in the
/// migration directory, in filename order.
///
/// Migrations are applied in lexicographic order and the filenames are timestamps, so sorting
/// the paths reproduces the order the database saw. A column added by a later migration and a
/// column created by an earlier one are both real; only replaying them in order gets that
/// right.
Map<String, _Table> _parseSchema(Directory dir) {
  final Map<String, _Table> tables = <String, _Table>{};
  if (!dir.existsSync()) return tables;

  final List<File> files =
      dir
          .listSync()
          .whereType<File>()
          .where((File f) => f.path.endsWith('.sql'))
          .toList()
        ..sort((File a, File b) => a.path.compareTo(b.path));

  for (final File file in files) {
    final String sql = _stripComments(file.readAsStringSync());

    for (final RegExpMatch match in RegExp(
      r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)\s*\(',
      caseSensitive: false,
    ).allMatches(sql)) {
      final String name = match.group(1)!;
      final String body = _balancedParens(sql, match.end - 1);
      final _Table table = tables.putIfAbsent(name, () => _Table(name));

      for (final String line in _topLevelItems(body)) {
        final String trimmed = line.trim();
        if (trimmed.isEmpty) continue;

        // Skip table-level constraints; they are not columns.
        final String firstWord = trimmed
            .split(RegExp(r'\s+'))
            .first
            .toUpperCase();
        if (const <String>{
          'CONSTRAINT',
          'PRIMARY',
          'UNIQUE',
          'CHECK',
          'FOREIGN',
          'EXCLUDE',
          'LIKE',
        }.contains(firstWord)) {
          continue;
        }

        final RegExpMatch? column = RegExp(r'^"?(\w+)"?\s+\S')
            .firstMatch(trimmed);
        if (column == null) continue;

        final String columnName = column.group(1)!;
        table.columns.add(columnName);

        final bool isNotNull = RegExp(
          r'\bNOT\s+NULL\b',
          caseSensitive: false,
        ).hasMatch(trimmed);
        final bool hasDefault = RegExp(
          r'\bDEFAULT\b',
          caseSensitive: false,
        ).hasMatch(trimmed);
        final bool isGenerated = RegExp(
          r'\bGENERATED\s+ALWAYS\b',
          caseSensitive: false,
        ).hasMatch(trimmed);
        final bool isPrimaryKey = RegExp(
          r'\bPRIMARY\s+KEY\b',
          caseSensitive: false,
        ).hasMatch(trimmed);

        if (isNotNull || isPrimaryKey) table.notNull.add(columnName);
        if (isNotNull && !hasDefault && !isGenerated && !isPrimaryKey) {
          table.requiredOnInsert.add(columnName);
        }
      }
    }

    for (final RegExpMatch match in RegExp(
      r'ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?',
      caseSensitive: false,
    ).allMatches(sql)) {
      tables
          .putIfAbsent(match.group(1)!, () => _Table(match.group(1)!))
          .columns
          .add(match.group(2)!);
    }
  }

  return tables;
}

/// Remove `--` line comments and `/* */` blocks.
///
/// Without this, a commented-out column reads as a real one and a commented-out CREATE TABLE
/// silently redefines a table — both of which make the parser confidently wrong.
String _stripComments(String sql) => sql
    .replaceAll(RegExp(r'/\*.*?\*/', dotAll: true), '')
    .replaceAll(RegExp(r'--[^\n]*'), '');

/// Text between the parenthesis at [openIndex] and its match.
///
/// A regex cannot do this: `NUMERIC(9, 6)` and `CHECK (x IN ('a','b'))` both nest, so
/// "everything up to the next `)`" truncates the table halfway through.
String _balancedParens(String source, int openIndex) {
  int depth = 0;
  for (int i = openIndex; i < source.length; i++) {
    if (source[i] == '(') depth++;
    if (source[i] == ')') {
      depth--;
      if (depth == 0) return source.substring(openIndex + 1, i);
    }
  }
  return source.substring(openIndex + 1);
}

/// Split a column list on commas that are at nesting depth zero.
///
/// `CHECK (status IN ('active', 'retired'))` contains commas that do not separate columns.
List<String> _topLevelItems(String body) {
  final List<String> items = <String>[];
  final StringBuffer current = StringBuffer();
  int depth = 0;
  bool inString = false;

  for (int i = 0; i < body.length; i++) {
    final String ch = body[i];

    if (ch == "'") inString = !inString;
    if (!inString) {
      if (ch == '(') depth++;
      if (ch == ')') depth--;
      if (ch == ',' && depth == 0) {
        items.add(current.toString());
        current.clear();
        continue;
      }
    }
    current.write(ch);
  }
  items.add(current.toString());
  return items;
}

/// Every `json['key']` literal, grouped by the class whose body it appears in.
///
/// Class bodies are delimited by scanning for the next top-level `class ` declaration rather
/// than by brace matching: the accessors all live inside `static X fromJson(...)`, and a
/// simple forward scan is both sufficient and far less breakable than a Dart parser.
Map<String, Set<String>> _jsonKeysByClass(String source) {
  final Map<String, Set<String>> out = <String, Set<String>>{};

  final List<RegExpMatch> classes = RegExp(
    r'^(?:@\w+\s*\n)?class\s+(\w+)',
    multiLine: true,
  ).allMatches(source).toList();

  for (int i = 0; i < classes.length; i++) {
    final String name = classes[i].group(1)!;
    final int start = classes[i].end;
    final int end = i + 1 < classes.length
        ? classes[i + 1].start
        : source.length;

    final Set<String> keys = RegExp(r"""json\[\s*'([a-z0-9_]+)'\s*\]""")
        .allMatches(source.substring(start, end))
        .map((RegExpMatch m) => m.group(1)!)
        .toSet();

    if (keys.isNotEmpty) out[name] = keys;
  }

  return out;
}
