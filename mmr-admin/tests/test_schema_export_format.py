"""
Format contract for GET /api/export-schema.

The committed db/schema_snapshot.sql is TSV produced by the mysql CLI in batch
mode, which escapes \\, tab and newline inside a field. The exporter used str()
instead, so every multi-line routine/trigger body broke the row structure and a
regenerated snapshot diffed as ~1300 bogus lines against the committed one.
"""
from api_schema import _tsv_value


class TestTsvValueEscaping:

    def test_none_becomes_null_literal(self):
        assert _tsv_value(None) == 'NULL'

    def test_newlines_escaped(self):
        assert _tsv_value('BEGIN\n  DECLARE x INT;\nEND') == 'BEGIN\\n  DECLARE x INT;\\nEND'

    def test_tabs_escaped(self):
        assert _tsv_value('a\tb') == 'a\\tb'

    def test_backslash_escaped_first(self):
        # Order matters: escaping \ after \n would double-escape the emitted \n.
        assert _tsv_value('a\\b\nc') == 'a\\\\b\\nc'

    def test_plain_values_untouched(self):
        assert _tsv_value('InnoDB') == 'InnoDB'
        assert _tsv_value(42) == '42'

    def test_result_is_single_line(self):
        assert '\n' not in _tsv_value('multi\nline\nbody')
