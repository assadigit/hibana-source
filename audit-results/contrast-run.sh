#!/bin/bash
CF=$(cat /home/z/my-project/hibana-work/audit-results/contrast-fn.js)
PROJ=b8a964de-e854-4386-96eb-02a39a66a16b
for combo in "fa light" "fa dark" "en light" "en dark"; do
  L=${combo% *}; T=${combo#* }
  agent-browser eval "localStorage.setItem('hibana-lang','$L'); localStorage.setItem('hibana-theme','$T'); 'ok'" > /dev/null
  for pg in /app /projects.html /to-do-list /calendar.html /settings.html /reports.html /sparks.html /notifications.html /archive.html /clients.html /project.html?id=$PROJ; do
    agent-browser open "http://localhost:8787$pg" > /dev/null 2>&1
    sleep 1.2
    R=$(agent-browser eval "$CF" 2>/dev/null | tail -1)
    echo "$L $T $pg $R" >> /home/z/my-project/hibana-work/audit-results/contrast-matrix.txt
  done
done
echo done
