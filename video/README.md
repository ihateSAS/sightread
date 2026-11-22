# The demo film

`sightread-demo.mp4` in the repository root is 46 seconds, 1920x1080, and is the video sent with the entry. It is
built with wkasekende's Cerebras video demos kit (github.com/wkasekende/cerebras-video-demos),
using a theme written for this project so the film carries Sightread's palette rather
than the kit's default.

What it shows, in order: the question typed into the hero composer, a capture of the
running page answering it, the conversation, the answer card with its counted list, and
the claim. The capture at 5.2s is the real app, driven by a headless browser against a
real Kimi K3.1 Pro endpoint. The rest is the kit's house style, which is why the film
still counts as a film and not a screen recording.

Rebuild it:

```bash
git clone https://github.com/wkasekende/cerebras-video-demos /tmp/kit && cd /tmp/kit
npm install
# merge ../theme.css into components/agent/agent.css and add "sightread" to THEMES
python3 tools/make-film.py /path/to/storyboard.json --theme sightread
bash tools/agent-film-check.sh      # ends with OK
```

Files here:

- `storyboard.json` (also `video/storyboard.json`), the whole film as one input: prompt, answer, claim, scene list
- `theme.css`, the theme rules, kept apart so the palette is reviewable on its own
- `real-run.mp4`, the unedited capture of the real page that the pop-in scene plays
- `../sightread-demo.mp4`, the finished film

Every number in the storyboard was measured, and the measurement is in `SUBMISSION.md`
beside the same coverage count. The claim footnote runs at 26px on purpose: the first
cut set it at 18px of grey, which is unreadable on a phone.
