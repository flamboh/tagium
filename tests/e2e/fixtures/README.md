These six-second 440 Hz sine tones are generated test audio, with title `waveform fixture`, artist `test artist`, and album `test album`. They exercise real browser decoding and clipping rather than synthetic container headers.

Generated with ffmpeg's `sine=frequency=440:duration=6` lavfi input, using `libmp3lame -b:a 32k`, `flac`, `aac -b:a 32k`, and `libopus -b:a 24k` respectively. No third-party audio is included.
