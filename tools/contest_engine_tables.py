"""按上游 CSV 的字段类型规则读取引擎表，同时支持已固定的历史 JSON 来源。"""
import json
from pathlib import Path
import re


def parse_csv(raw):
    # 与固定上游的 parseCsvRows 一致：引号可从字段中途开始，空行在取表头前过滤。
    text=raw.decode();rows=[];row=[];field=[];quoted=False;index=0
    def end_row():
        nonlocal row,field
        value=''.join(field);row.append(value)
        if len(row)>1 or value:rows.append(row)
        row=[];field=[]
    while index<len(text):
        char=text[index]
        if quoted:
            if char!='"':field.append(char)
            elif index+1<len(text) and text[index+1]=='"':field.append('"');index+=1
            else:quoted=False
        elif char=='"':quoted=True
        elif char==',':row.append(''.join(field));field=[]
        elif char in ('\r','\n'):
            if char=='\r' and index+1<len(text) and text[index+1]=='\n':index+=1
            end_row()
        else:field.append(char)
        index+=1
    if row or field:end_row()
    if not rows:return []
    header,*rows=rows
    def value(field):
        if field=='TRUE':return True
        if field=='FALSE':return False
        if re.fullmatch('[0-9]+',field):return int(field)
        return field
    return [dict(zip(header,map(value,row))) for row in rows]


def read_table(source,name):
    source=Path(source);legacy=source/'json'/f'{name}.json'
    if legacy.exists():return json.loads(legacy.read_bytes())
    return parse_csv((source/'csv'/f'{name}.csv').read_bytes())
