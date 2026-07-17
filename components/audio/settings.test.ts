import { describe, expect, it } from "vite-plus/test";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
  loadAppSettings,
  saveAppSettings,
} from "./settings";
import type { AppSettings } from "./types";

const storageWith = (initialValue: string | null) => {
  let savedValue: string | null = initialValue;

  return {
    getItem: (key: string) => (key === APP_SETTINGS_STORAGE_KEY ? savedValue : null),
    setItem: (key: string, value: string) => {
      if (key === APP_SETTINGS_STORAGE_KEY) {
        savedValue = value;
      }
    },
    savedValue: () => savedValue,
  };
};

describe("settings", () => {
  it("uses defaults when no settings are stored", () => {
    expect(loadAppSettings(storageWith(null))).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("uses defaults when stored settings cannot be read", () => {
    const storage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(loadAppSettings(storage)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("fills new default keys when stored settings are incomplete", () => {
    const storage = storageWith(JSON.stringify({ syncTrackNumbers: false }));

    expect(loadAppSettings(storage)).toEqual({
      ...DEFAULT_APP_SETTINGS,
      syncTrackNumbers: false,
    });
  });

  it("loads a stored theme", () => {
    const storage = storageWith(JSON.stringify({ theme: "pressing" }));

    expect(loadAppSettings(storage)).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: "pressing",
    });
  });

  it("ignores invalid stored setting values", () => {
    const storage = storageWith(
      JSON.stringify({
        theme: "neon",
        syncTrackNumbers: false,
        syncFilenames: "no",
        audioBitrate: "999",
        applySoundCloudAlbumCoverToTracks: "yes",
      }),
    );

    expect(loadAppSettings(storage)).toEqual({
      ...DEFAULT_APP_SETTINGS,
      syncTrackNumbers: false,
    });
  });

  it("saves app settings", () => {
    const storage = storageWith(null);
    const settings: AppSettings = {
      theme: "liner",
      syncTrackNumbers: false,
      syncFilenames: false,
      audioBitrate: "256",
      applySoundCloudAlbumCoverToTracks: false,
    };

    const saved = saveAppSettings(settings, storage);

    expect(saved).toBe(true);
    expect(storage.savedValue()).toBe(JSON.stringify(settings));
  });

  it("ignores app settings save failures", () => {
    const storage = {
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };
    const settings: AppSettings = {
      theme: "pressing",
      syncTrackNumbers: false,
      syncFilenames: false,
      audioBitrate: "256",
      applySoundCloudAlbumCoverToTracks: false,
    };

    expect(saveAppSettings(settings, storage)).toBe(false);
  });
});
