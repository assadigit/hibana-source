#!/bin/bash
# Session-9 audit sweep. Usage: sweep.sh <lang> <theme> <width> <height> <suffix> <pages...>
L=$1; T=$2; W=$3; H=$4; S=$5; shift 5
RES=/home/z/my-project/hibana-work/audit-results
FN=$(cat $RES/audit-fn.js)
agent-browser set viewport $W $H > /dev/null
agent-browser eval "localStorage.setItem('hibana-lang','$L'); localStorage.setItem('hibana-theme','$T'); 'ok'" > /dev/null
for P in "$@"; do
  agent-browser open "http://localhost:8787$P" > /dev/null 2>&1
  sleep 1.4
  R=$(agent-browser eval "$FN" 2>/dev/null | tail -1)
  E=$(agent-browser errors 2>/dev/null | grep -v "^stderr" | grep -v "launched browser" | head -5)
  echo "PAGE $P|$R|ERR:${E:-none}" >> $RES/sweep-$S.txt
  agent-browser errors --clear > /dev/null 2>&1
done
echo "sweep $S done: $(grep -c PAGE $RES/sweep-$S.txt) pages"
