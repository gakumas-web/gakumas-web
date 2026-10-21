"""验证 CSV 运行表保持上游字段类型、引号及换行语义。"""
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from contest_engine_tables import parse_csv,read_table


class ContestEngineTablesTest(unittest.TestCase):
    def test_csv_skips_leading_empty_rows_before_reading_header(self):
        self.assertEqual(parse_csv(b'\nid,name\n1,one\n'),[{'id':1,'name':'one'}])

    def test_csv_quote_after_space_still_opens_a_quoted_field(self):
        self.assertEqual(parse_csv(b'id,name\n1, "one,two"\n'),[{'id':1,'name':' one,two'}])

    def test_csv_quotes_inside_unquoted_text_follow_upstream_state_machine(self):
        self.assertEqual(parse_csv(b'id,name\n1,a"b"\n'),[{'id':1,'name':'ab'}])

    def test_csv_types_quotes_and_empty_fields_match_upstream(self):
        raw='id,name,upgraded,unique,actions,limit,price\r\n1,"名前,「例」",TRUE,FALSE,"score+=1;\r\ngenki+=2",,"40,70"\r\n2,"引用""符",FALSE,TRUE,,-1,0.5\r\n\r\n""\r\n'.encode()
        self.assertEqual(parse_csv(raw),[
            {'id':1,'name':'名前,「例」','upgraded':True,'unique':False,'actions':'score+=1;\r\ngenki+=2','limit':'','price':'40,70'},
            {'id':2,'name':'引用"符','upgraded':False,'unique':True,'actions':'','limit':'-1','price':'0.5'},
        ])

    def test_historical_json_and_current_csv_read_the_same_records(self):
        records=[{'id':1,'name':'名前','upgraded':False,'limit':''}]
        with TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'csv').mkdir();(root/'json').mkdir()
            (root/'csv/skill_cards.csv').write_text('id,name,upgraded,limit\n1,名前,FALSE,\n')
            self.assertEqual(read_table(root,'skill_cards'),records)
            (root/'json/skill_cards.json').write_text(json.dumps(records))
            self.assertEqual(read_table(root,'skill_cards'),records)


if __name__=='__main__':unittest.main()
