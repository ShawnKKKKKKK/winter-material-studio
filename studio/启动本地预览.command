#!/bin/zsh
cd "$(dirname "$0")"
if [[ ! -d dist ]]; then
  print "请先运行 npm ci 和 npm run build。"
  read
  exit 1
fi
print "打开 http://127.0.0.1:5174/ 试用。关闭此终端可停止网站。"
python3 -m http.server 5174 --bind 127.0.0.1 --directory dist
