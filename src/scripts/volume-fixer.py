from os import listdir, unlink
import subprocess
import sys
from os.path import isfile, join

song_dir = sys.argv[1]
quiet_threshold = float(sys.argv[2])

songs = [f for f in listdir(song_dir) if isfile(join(song_dir, f))]
files_removed = 0
for idx, song in enumerate(songs):
    if not song.endswith('.ogg'):
        continue
    song_path = join(song_dir, song);
    print(f"Checking {song} ({idx+1}/{len(songs)})")
    cmd = f"ffmpeg -i {song_path} -af 'volumedetect' -f null /dev/null 2>&1 | grep max_volume | awk -F': ' '{{print $2}}' | cut -d' ' -f1"
    detected_volume = float(subprocess.check_output(cmd, shell=True).decode("utf-8").strip())
    
    if int(detected_volume) == 0: 
        print(f"Loud file detected and removed: {song}")
        unlink(song_path)
        files_removed += 1

    if detected_volume < quiet_threshold:
        print(f"Quiet file detected and removed: {song}")
        unlink(song_path)
        files_removed += 1

print(f"Removed {files_removed} songs")

