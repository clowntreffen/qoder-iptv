#!/usr/bin/env python3
"""Static file server for the local HLS stream with permissive CORS headers.

The app runs on the Vite dev port (or on a TV) and must be able to fetch the
playlist/segments cross-origin, so this adds Access-Control-Allow-Origin: *
(plus the range/options handling used by media playback).
"""
import argparse
import functools
import http.server
import os
import socketserver


class CorsHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--bind', default='0.0.0.0')
    ap.add_argument('--directory', required=True)
    args = ap.parse_args()

    handler = functools.partial(CorsHandler, directory=args.directory)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((args.bind, args.port), handler) as httpd:
        print(f'[stream] serving {os.path.abspath(args.directory)} on {args.bind}:{args.port}')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
