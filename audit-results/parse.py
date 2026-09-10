#!/usr/bin/env python3
"""Parse agent-browser sweep output files into a readable table."""
import sys, json, glob

def parse_line(line):
    parts = line.strip().split('|', 1)
    if len(parts) < 2:
        return None
    page = parts[0].replace('PAGE ', '')
    rest = parts[1]
    # rest = <maybe-quoted-json>|ERR:<errors>
    jend = rest.rfind('}')
    raw_json = rest[:jend + 1]
    errs = rest[jend + 1:].replace('|ERR:', '').strip()
    j = None
    for attempt in (raw_json, raw_json.strip('"').replace('\\"', '"').replace('\\\\', '\\')):
        try:
            j = json.loads(attempt)
            break
        except Exception:
            continue
    if j is None:
        return (page, None, errs)
    return (page, j, errs)

def render(page, j, errs, mobile=False):
    if j is None:
        return f"{page}: PARSE-FAIL"
    flags = []
    if j.get('pageHScroll'):
        flags.append(f"HSCROLL scrollW={j['scrollW']}")
    if j.get('viewportOverflowCount', 0):
        flags.append(f"OVF:{j['viewportOverflowCount']}:[{';'.join(j['viewportOverflows'][:3])}]")
    if j.get('clippedCount', 0):
        flags.append(f"CLIP:{j['clippedCount']}:[{';'.join(j['clippedText'][:3])}]")
    if j.get('imgNoAlt'):
        flags.append(f"NOALT:{j['imgNoAlt']}")
    if j.get('dirMismatch'):
        flags.append('DIR-MISMATCH')
    # touch targets matter on mobile only for pass/fail
    if mobile and j.get('smallTouchCount', 0):
        flags.append(f"TOUCH:{j['smallTouchCount']}:[{';'.join(j['smallTouchTargets'][:4])}]")
    if errs and errs != 'none':
        flags.append(f"JSERR:{errs[:250]}")
    actual = j.get('url', '?')
    note = f" → {actual}" if actual not in (page, page.split('?')[0]) else ''
    return f"{page}{note}: {j.get('lang')}/{j.get('dir')}/{j.get('theme')} vw={j.get('vw')} {' | '.join(flags) if flags else 'CLEAN'}"

if __name__ == '__main__':
    mobile = any('390' in f or 'mobile' in f for f in sys.argv[1:])
    files = sys.argv[1:] or sorted(glob.glob('sweep-*.txt'))
    for f in files:
        print(f"===== {f} =====")
        for line in open(f):
            r = parse_line(line)
            if r:
                print(render(*r, mobile=mobile or '390' in f))
