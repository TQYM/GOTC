import glob, json, os
from pptx import Presentation
from pptx.util import Inches
shots = sorted(glob.glob('/tmp/pptbuild/shots/*.png'))
notes = {n['id']: n for n in json.load(open('/tmp/pptbuild/notes.json'))}
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
for shot in shots:
    sid = os.path.basename(shot)[3:-4]
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.shapes.add_picture(shot, 0, 0, width=prs.slide_width, height=prs.slide_height)
    n = notes.get(sid, {})
    lines = []
    if n.get('purpose'): lines.append('【目的】' + n['purpose'])
    for t in n.get('talk', []): lines.append('· ' + t)
    if n.get('cue'): lines.append('【提示】' + n['cue'])
    if n.get('transition'): lines.append('【过渡】' + n['transition'])
    if lines: s.notes_slide.notes_text_frame.text = '\n'.join(lines)
prs.save('docs/ppt/CITY20.pptx')
print('ok', len(shots))
