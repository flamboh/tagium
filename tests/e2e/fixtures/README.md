These six-second 440 Hz sine tones are generated test audio, with title `waveform fixture`, artist `test artist`, and album `test album`. They exercise real browser decoding and clipping rather than synthetic container headers.

Generated with ffmpeg's `sine=frequency=440:duration=6` lavfi input, using `libmp3lame -b:a 32k`, `flac`, `aac -b:a 32k`, and `libopus -b:a 24k` respectively. No third-party audio is included.

`dj-analysis.mp3` and `dj-analysis.m4a` are 24 seconds of a synthesized kick on every beat at 128 bpm under a sustained A minor chord, with title `dj fixture` and artist `test artist`. They give tempo and key detection something real to find. Generated with ffmpeg's `aevalsrc` lavfi input (six sines at 220, 261.63, 329.63, 440, 523.25 and 659.26 Hz plus a decaying 50–150 Hz sweep every 0.46875 s), mono, using `libmp3lame -b:a 48k` and `aac -b:a 48k`.
