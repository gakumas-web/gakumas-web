"""提供禁用浏览器缓存的本地静态预览。"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from content_source import configure_content_channel


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        # 旧预览可能已被缓存，刷新时必须返回当前文件正文。
        for name in ('If-Modified-Since', 'If-None-Match'):
            if name in self.headers:
                del self.headers[name]
        return super().send_head()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('port', type=int, nargs='?', default=18765)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--directory', default='dist')
    parser.add_argument('--content-channel-url', help='显式 HTTPS 公共资料频道；保留本地频道供首次启动使用')
    args = parser.parse_args()
    if args.content_channel_url:
        configure_content_channel(args.directory, args.content_channel_url)
    handler = partial(PreviewHandler, directory=args.directory)
    with ThreadingHTTPServer((args.bind, args.port), handler) as server:
        print(f'Serving preview at http://{args.bind}:{args.port}/', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
