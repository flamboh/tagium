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
    filename: "bangarang",
    title: "Bangarang",
    artist: "Skrillex",
    album: "Bangarang EP",
    year: "2011",
    genre: "Dubstep",
    trackNumber: "2",
  },
  {
    filename: "ghosts-n-stuff",
    title: "Ghosts 'n' Stuff",
    artist: "deadmau5",
    album: "For Lack of a Better Name",
    year: "2009",
    genre: "Electro House",
    trackNumber: "4",
  },
  {
    filename: "midnight-city",
    title: "Midnight City",
    artist: "M83",
    album: "Hurry Up, We're Dreaming",
    year: "2011",
    genre: "Synthpop",
    trackNumber: "2",
  },
  {
    filename: "idioteque",
    title: "Idioteque",
    artist: "Radiohead",
    album: "Kid A",
    year: "2000",
    genre: "Electronic",
    trackNumber: "8",
  },
  {
    filename: "frontier-psychiatrist",
    title: "Frontier Psychiatrist",
    artist: "The Avalanches",
    album: "Since I Left You",
    year: "2000",
    genre: "Plunderphonics",
    trackNumber: "13",
  },
] satisfies SampleTrackMetadata[];

export const sampleAlbums = [
  {
    title: "Discovery",
    artist: "Daft Punk",
    year: "2001",
    genre: "French House",
  },
  {
    title: "In Colour",
    artist: "Jamie xx",
    year: "2015",
    genre: "Electronic",
  },
  {
    title: "Madvillainy",
    artist: "Madvillain",
    year: "2004",
    genre: "Hip-Hop",
  },
  {
    title: "Random Access Memories",
    artist: "Daft Punk",
    year: "2013",
    genre: "Disco",
  },
  {
    title: "Since I Left You",
    artist: "The Avalanches",
    year: "2000",
    genre: "Plunderphonics",
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
