#!/bin/zsh
# Records the demo: a fresh Claude Code session, /crossy-code, the character picker, then the autopilot.
# demo/record.sh [seed] [autopilot seconds]
# Writes demo/crossy-code.mp4 and demo/crossy-code.gif. Needs vhs and gifski (brew install vhs gifski).

set -euo pipefail
SEED=${1:-40}
AUTO=${2:-24}
REPO=${0:A:h:h}
WORK=$(mktemp -d)
PLUGIN=$WORK/plugin

# a copy of the plugin with the autopilot in it; the repo stays as it is
rsync -a --exclude .git --exclude demo $REPO/ $PLUGIN/
sed "s|'../hooks/|'./|" $REPO/demo/autopilot.ts > $PLUGIN/hooks/autopilot.ts
patch -s -p1 -d $PLUGIN < $REPO/demo/register.patch
sed -i '' "s/__DEMO_SEED__/$SEED/; s/__AUTO_SECONDS__/$AUTO/" $PLUGIN/hooks/register.tsx

# env -i keeps this session's variables out of the recorded one
cat > $WORK/demo.tape <<TAPE
Output take.mp4
Set Shell zsh
Set FontSize 16
Set Width 1600
Set Height 1000
Set Padding 20
Set Framerate 30
Set TypingSpeed 75ms
Set Theme "Builtin Dark"
Hide
Type@1ms "cd $REPO && clear && env -i HOME=\$HOME USER=\$USER LOGNAME=\$USER PATH=\$PATH TERM=xterm-256color COLORTERM=truecolor LANG=en_US.UTF-8 SHELL=/bin/zsh claude --plugin-dir $PLUGIN"
Enter
Sleep 8s
Show
Sleep 1.5s
Type "/crossy-code"
Sleep 600ms
Enter
Sleep 3s
Type "c"
Sleep 1.5s
Type "d"
Sleep 1.2s
Type "d"
Sleep 1.2s
Type "d"
Sleep 1.5s
Type "c"
Sleep 1.2s
Type "w"
Sleep $(( AUTO + 9 ))s
Hide
Type "q"
Sleep 500ms
Ctrl+C
Sleep 300ms
Ctrl+C
TAPE

(cd $WORK && vhs demo.tape)
ffmpeg -v error -y -i $WORK/take.mp4 -c:v libx264 -pix_fmt yuv420p -crf 18 -preset slow -movflags +faststart $REPO/demo/crossy-code.mp4
# small enough for the README: 720 wide, 10 frames a second
ffmpeg -v error -y -i $WORK/take.mp4 -vf "fps=10,scale=720:-1:flags=lanczos" -f yuv4mpegpipe - |
  gifski --quiet --fps 10 --quality 60 --lossy-quality 40 -o $REPO/demo/crossy-code.gif -
rm -rf $WORK
ls -lh $REPO/demo/crossy-code.mp4 $REPO/demo/crossy-code.gif
