"""将浏览器检查产物集中写入 local/checks，保留调用者指定的外部输出位置。"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def artifact_path(value):
    path = Path(value)
    try:
        relative = path.resolve().relative_to(ROOT/'local')
    except ValueError:
        return path
    target = ROOT/'local'/relative if relative.parts[:1] == ('checks',) else ROOT/'local/checks'/relative
    target.parent.mkdir(parents=True, exist_ok=True)
    return target
