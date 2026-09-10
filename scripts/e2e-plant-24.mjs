// Task 24 E2E planter — creates calendar test data for e2e@test.local on the LOCAL node server.
const BASE = 'http://localhost:8787'
const COOKIE = process.env.E2E_COOKIE // raw Cookie header value

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = text.slice(0, 200) }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`)
  return data
}

const iso = (offsetDays) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const main = async () => {
  // A client project to attach the drop-created task to + a spark for the sparks dialog test.
  const proj = await api('POST', '/api/projects', { title: 'پروژهٔ مشتری هتل', status: 'building', type: 'client', due_date: iso(7) })
  const spark = await api('POST', '/api/projects', { title: 'ایدهٔ تست اسپارک', status: 'spark' })
  console.log('project:', proj.id, 'spark:', spark.id)

  // 10 notes on TODAY → .lots pin scaling; 6 sadhana tasks tomorrow → .many.
  for (let i = 1; i <= 10; i++) {
    await api('POST', '/api/notes', { kind: 'note', content: `یادداشت تست ${i}`, note_date: iso(0), sticky: i % 2 === 0, color: i % 3 === 0 ? 'green' : 'yellow' })
  }
  for (let i = 1; i <= 6; i++) {
    await api('POST', '/api/sadhana/tasks', { quadrant: 1, title: `کار تقویمی ${i}`, due_date: iso(1) })
  }
  // A client task on the project due tomorrow (task-kind pin).
  await api('POST', `/api/projects/${proj.id}/tasks`, { title: 'تحویل اولیهٔ هتل', due_date: iso(1) })
  console.log('planted: 10 notes today, 6 sadhana + 1 client task tomorrow, project due +7d')
}

main().catch((e) => { console.error(e); process.exit(1) })
