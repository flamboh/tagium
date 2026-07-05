export interface SampleTrackMetadata {
  filename: string;
  title: string;
  artist: string;
  album: string;
  year: string;
  genre: string;
  trackNumber: string;
}

export interface SampleAlbumMetadata {
  title: string;
  artist: string;
  year: string;
  genre: string;
}

export const sampleTracks = [
  {
    filename: "Bangarang",
    title: "Bangarang",
    artist: "Skrillex",
    album: "Bangarang EP",
    year: "2011",
    genre: "Dubstep",
    trackNumber: "2",
  },
  {
    filename: "MANNEQUIN",
    title: "MANNEQUIN",
    artist: "Che",
    album: "REST IN BASS",
    year: "2025",
    genre: "Rage",
    trackNumber: "11",
  },
  {
    filename: "Roll with Me",
    title: "Roll with Me",
    artist: "Charli xcx",
    album: "Number 1 Angel",
    year: "2017",
    genre: "Electropop",
    trackNumber: "4",
  },
  {
    filename: "angels in camo",
    title: "angels in camo",
    artist: "Jane Remover",
    album: "Revengeseekerz",
    year: "2025",
    genre: "Rage",
    trackNumber: "5",
  },
  {
    filename: "THIS IS FOR",
    title: "THIS IS FOR",
    artist: "TWICE",
    album: "THIS IS FOR",
    year: "2025",
    genre: "K-Pop",
    trackNumber: "2",
  },
  {
    filename: "love hate",
    title: "love hate",
    artist: "xaviersobased",
    album: "with 2 (hosted by d9lton)",
    year: "2024",
    genre: "Jerk",
    trackNumber: "3",
  },
  {
    filename: "1-800-FUCKOFF",
    title: "1-800-FUCKOFF",
    artist: "kimj",
    album: "KOREAN AMERICAN",
    year: "2025",
    genre: "Electropop",
    trackNumber: "3",
  },
  {
    filename: "Locals (Girls like us) [with gabby start]",
    title: "Locals (Girls like us) [with gabby start]",
    artist: "underscores",
    album: "Wallsocket",
    year: "2023",
    genre: "Electropop",
    trackNumber: "2",
  },
  {
    filename: "it's up to YOU now!!",
    title: "it's up to YOU now!!",
    artist: "leroy",
    album: "Grave Robbing",
    year: "2023",
    genre: "Hard Dance",
    trackNumber: "4",
  },
  {
    filename: "Recoil",
    title: "Recoil",
    artist: "venturing",
    album: "Ghostholding",
    year: "2025",
    genre: "Emo Rock",
    trackNumber: "6",
  },
  {
    filename: "RADIO (feat. Kim Petras)",
    title: "RADIO (feat. Kim Petras)",
    artist: "Frost Children",
    album: "SISTER",
    year: "2025",
    genre: "Dance-Pop",
    trackNumber: "9",
  },
  {
    filename: "i just banged a snus in canada water",
    title: "i just banged a snus in canada water",
    artist: "Jim Legxacy",
    album: "black british music",
    year: "2025",
    genre: "UK Hip Hop",
    trackNumber: "11",
  },
  {
    filename: "Industry Corporate Freak",
    title: "Industry Corporate Freak",
    artist: "Syzy",
    album: "Industry Corporate Freak",
    year: "2025",
    genre: "Complextro",
    trackNumber: "1",
  },
  {
    filename: "Razor Sharp",
    title: "Razor Sharp",
    artist: "Pegboard Nerds",
    album: "Razor Sharp",
    year: "2013",
    genre: "Brostep",
    trackNumber: "1",
  },
  {
    filename: "IN THE WALLS",
    title: "IN THE WALLS",
    artist: "funeral",
    album: "IN THE WALLS",
    year: "2022",
    genre: "Witch House",
    trackNumber: "1",
  },
  {
    filename: "Died But Came Back",
    title: "Died But Came Back",
    artist: "slayr",
    album: "Died But Came Back",
    year: "2026",
    genre: "Digicore",
    trackNumber: "10",
  },
] satisfies SampleTrackMetadata[];

export const sampleAlbums = [
  {
    title: "you seem pretty sad for a girl so in love",
    artist: "Olivia Rodrigo",
    year: "2026",
    genre: "Pop Rock",
  },
  {
    title: "Total Sellout",
    artist: "Jae Stephens",
    year: "2025",
    genre: "Pop",
  },
  {
    title: "black british music",
    artist: "Jim Legxacy",
    year: "2025",
    genre: "UK Hip Hop",
  },
  {
    title: "hypochondriac",
    artist: "brakence",
    year: "2022",
    genre: "Glitch Pop",
  },
  {
    title: "how i'm feeling now",
    artist: "Charli xcx",
    year: "2020",
    genre: "Hyperpop",
  },
  {
    title: "Somewhere City",
    artist: "Origami Angel",
    year: "2019",
    genre: "Emo-Pop",
  },
  {
    title: "Pretti",
    artist: "prettifun",
    year: "2024",
    genre: "Rage",
  },
  {
    title: "The weight of the world",
    artist: "syzy",
    year: "2024",
    genre: "Dubstep",
  },
] satisfies SampleAlbumMetadata[];

export const sampleIndexFromSeed = (seed: string, itemCount: number) => {
  let hash = 0;

  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return hash % itemCount;
};

export const getSampleTrack = (seed: string) =>
  sampleTracks[sampleIndexFromSeed(seed, sampleTracks.length)];

export const getSampleAlbum = (seed: string) =>
  sampleAlbums[sampleIndexFromSeed(seed, sampleAlbums.length)];
