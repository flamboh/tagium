import { readFileSync, writeFileSync } from "node:fs";

const [path] = process.argv.slice(2);

const source = readFileSync(path, "utf8");

const original = `if (streamInfo.audioFormat === 'mp4a') {
        args.push('-movflags', 'frag_keyframe+empty_moov');
    }`;

const patched = `if (['mp4a', 'm4a'].includes(streamInfo.audioFormat)) {
        args.push(
            '-movflags', 'frag_keyframe+empty_moov',
            '-frag_duration', '1000000'
        );
    }`;

if (!source.includes(original)) {
  throw new Error(`cobalt ffmpeg audio args changed; review the m4a patch in ${path}`);
}

writeFileSync(path, source.replace(original, patched));
