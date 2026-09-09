// Session-15 local e2e planter: give e2e@test.local a small stage-box portfolio
// (projects in the 3 main working stages + 2 secondary) + bug bubbles, mirroring the
// planted-state discipline (local scratch DB only — never D1).
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync('/home/z/my-project/hibana-work/data/hibana.db')
const uid = db.prepare('SELECT id FROM users WHERE email=?').get('e2e@test.local').id
db.prepare('DELETE FROM dev_tasks WHERE project_id IN (SELECT id FROM projects WHERE user_id=?)').run(uid)
db.prepare('DELETE FROM projects WHERE user_id=?').run(uid)

const now = Date.now()
const iso = (d) => new Date(d).toISOString()
const rows = [
  ['رزرو آنلاین هتل', 'investigating', 0],
  ['اسناد مشکل', 'awaiting', 1],
  ['۳۰ روز انقضا اقلام', 'doing', 2],
  ['بازطراحی لندینگ', 'doing', 3],
  ['اتوماسیون گزارش', 'awaiting', 4],
  ['همکاری با تامین‌کننده', 'unreviewed', 5],
  ['اپ موبایل نسخه ۲', 'halted', 6],
  ['پنل مشتریان', 'operational', 7],
]
const ins = db.prepare(`INSERT INTO projects (id,user_id,title,status,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
const insT = db.prepare(`INSERT INTO dev_tasks (id,project_id,title,status,created_at) VALUES (?,?,?,?,?)`)
for (const [title, status, order] of rows) {
  const pid = 'p-' + Math.random().toString(36).slice(2, 10)
  ins.run(pid, uid, title, status, order, iso(now - 86400000 * 5), iso(now - 3600000 * 8))
  if (status === 'awaiting') {
    insT.run('t1-' + Math.random().toString(36).slice(2, 8), pid, 'رفع باگ پرداخت', 'bug', iso(now))
    insT.run('t2-' + Math.random().toString(36).slice(2, 8), pid, 'به‌روزرسانی وابستگی‌ها', 'bug', iso(now))
    insT.run('t3-' + Math.random().toString(36).slice(2, 8), pid, 'خطای احراز هویت', 'bug', iso(now))
  }
}
console.log('planted:', db.prepare('SELECT count(*) c FROM projects WHERE user_id=?').get(uid).c, 'projects')
db.close()
