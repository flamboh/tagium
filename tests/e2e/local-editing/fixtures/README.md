`tagged.{mp3,flac,m4a,opus}` are 0.8-second sine tones (440, 550, 660 and 770 Hz) written by FFmpeg with no cover art and these tags: title `Café 東京 🎵 <format>`, artist `Björk & 王 🦊`, album `Night Signals 🌙`, album artist `Various Artists 🎼`, date `2024`, genre `Ambient / 電子`, track `7/12`, disc `2/3`, composer `Zoë`, comment `first line\nsecond line`.

FFmpeg stores the comment the way other taggers find hard to read: an ID3v2.4 `TXXX:comment` frame in MP3 and a Vorbis `DESCRIPTION` field in FLAC and Opus. M4A uses `©cmt`.

Generated with:

```sh
for f in mp3 flac m4a opus; do
  ffmpeg -f lavfi -i "sine=frequency=<hz>:duration=0.8" -c:a <libmp3lame|flac|aac|libopus> \
    -metadata title="Café 東京 🎵 $f" -metadata artist="Björk & 王 🦊" \
    -metadata album="Night Signals 🌙" -metadata album_artist="Various Artists 🎼" \
    -metadata date=2024 -metadata genre="Ambient / 電子" -metadata track=7/12 -metadata disc=2/3 \
    -metadata composer="Zoë" -metadata comment=$'first line\nsecond line' "tagged.$f"
done
```
