#!/usr/bin/env python3
"""Put a voice on a rendered film: narration at fixed moments, a quiet bed under it, one MP4 out.

    python3 voiceover.py [--film santa-shopper.mp4] [--out santa-shopper-vo.mp4]

`narration.json` is the script: [{"at": ms, "voice": <an edge-tts voice>, "text": "..."}]. The moments are
the film's scene starts (make-film.py prints them), so a re-render keeps the words on their beats. Each line
is checked against the next line's start before anything is built: a line that runs into the next one is a
refusal, not a guess. The bed is generated, not borrowed: two pads a fifth apart, tremolo, a long tail and a
whisper of pink noise, so there is no third party's material in the file.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.join(HERE, "film.mp4")
OUT = os.path.join(HERE, "film-vo.mp4")
args = sys.argv[1:]
if "--film" in args: FILM = os.path.abspath(args[args.index("--film") + 1])
if "--out" in args: OUT = os.path.abspath(args[args.index("--out") + 1])

lines = json.load(open(os.path.join(HERE, "narration.json")))
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", FILM],
                           capture_output=True, text=True).stdout.strip())
os.makedirs(os.path.join(HERE, "voice"), exist_ok=True)

# 1. the lines, and the refusal: a line must end before the next one starts
ends = []
for i, l in enumerate(lines):
    mp3 = os.path.join(HERE, "voice", "l%d.mp3" % (i + 1))
    for attempt in range(4):  # the TTS service drops a request now and then
        if subprocess.run(["python3", "-m", "edge_tts", "--voice", l["voice"], "--text", l["text"], "--write-media", mp3]).returncode == 0: break
        __import__("time").sleep(2)
    else: sys.exit("line %d: no audio after 4 tries" % (i + 1))
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp3],
                             capture_output=True, text=True).stdout)
    end = l["at"] / 1000 + d
    nxt = lines[i + 1]["at"] / 1000 if i + 1 < len(lines) else dur
    if end > nxt:
        sys.exit("line %d ends at %.2f s, line %d starts at %.2f s: shorten it, or move it" % (i + 1, end, i + 2, nxt))
    if end > dur:
        sys.exit("line %d ends at %.2f s, the film is %.2f s" % (i + 1, end, dur))
    ends.append(end)
    print("  line %d at %.2f s, %.2f s long, ends %.2f s" % (i + 1, l["at"] / 1000, d, end))

# 2. the bed: generated here, so nothing is licensed from anyone
D = "%.3f" % dur
subprocess.run(
    "ffmpeg -v error -y -f lavfi -i sine=f=110:d=%s -f lavfi -i sine=f=164.81:d=%s -f lavfi -i sine=f=220:d=%s "
    "-f lavfi -i anoisesrc=color=pink:duration=%s:amplitude=0.03 -filter_complex "
    "\"[0]volume=0.16[a];[1]volume=0.10[b];[2]volume=0.07[c];[3]lowpass=f=900,volume=0.5[n];"
    "[a][b][c][n]amix=inputs=4:normalize=0,tremolo=f=0.12:d=0.45,lowpass=f=1600,aecho=0.8:0.7:180|360:0.35|0.18,"
    "afade=t=in:st=0:d=2.2,afade=t=out:st=%.2f:d=3.6,volume=0.55[out]\" -map \"[out]\" -ar 48000 -ac 2 %s"
    % (D, D, D, D, dur - 3.6, os.path.join(HERE, "bed.wav")), shell=True, check=True)

# 3. the mix: the bed under the lines at their moments, normalised once
ins, fl = [], ["[0]volume=2.2[bed]"]
for i, l in enumerate(lines):
    ins.append("-i %s" % os.path.join(HERE, "voice", "l%d.mp3" % (i + 1)))
    fl.append("[%d]aformat=channel_layouts=stereo,adelay=%d|%d[v%d]" % (i + 1, l["at"], l["at"], i))
mix = "[bed]" + "".join("[v%d]" % i for i in range(len(lines)))
graph = ";".join(fl) + ";%samix=inputs=%d:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9,alimiter=limit=0.95[mix]" % (mix, len(lines) + 1)
subprocess.run("ffmpeg -v error -y -i %s %s -filter_complex \"%s\" -map \"[mix]\" -t %s -ar 48000 -ac 2 %s"
               % (os.path.join(HERE, "bed.wav"), " ".join(ins), graph, D, os.path.join(HERE, "mix.wav")), shell=True, check=True)

# 4. mux: the picture is copied, never re-encoded
subprocess.run("ffmpeg -v error -y -i %s -i %s -c:v copy -c:a aac -b:a 192k -movflags +faststart -shortest %s"
               % (FILM, os.path.join(HERE, "mix.wav"), OUT), shell=True, check=True)
print("DONE: %s (%.1f s, %.1f MB)" % (OUT, dur, os.path.getsize(OUT) / 1e6))
