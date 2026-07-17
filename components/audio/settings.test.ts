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
      if (key === APP_SETTINGS_STORAGE_KEY) savedValue = value;
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
    expect(loadAppSettings(storageWith(JSON.stringify({ syncTrackNumbers: false })))).toEqual({
      ...DEFAULT_APP_SETTINGS,
      syncTrackNumbers: false,
    });
  });

  it("loads stored appearance settings", () => {
    const appearance = {
      mode: "dark",
      accentA: "#90101a",
      accentB: "#00939a",
      wordmarkFont: "rajdhani",
    } as const;
    expect(loadAppSettings(storageWith(JSON.stringify(appearance)))).toEqual({
      ...DEFAULT_APP_SETTINGS,
      ...appearance,
    });
  });

  it("migrates the old dark theme and defaults the new appearance keys", () => {
    expect(loadAppSettings(storageWith(JSON.stringify({ theme: "signal" })))).toEqual({
      ...DEFAULT_APP_SETTINGS,
      mode: "dark",
    });
  });

  it("migrates every other old theme to light", () => {
    expect(loadAppSettings(storageWith(JSON.stringify({ theme: "liner" })))).toEqual(
      DEFAULT_APP_SETTINGS,
    );
  });

  it("does not consult the old theme when mode is present but invalid", () => {
    expect(
      loadAppSettings(storageWith(JSON.stringify({ mode: "bogus", theme: "signal" }))),
    ).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("ignores invalid stored setting values", () => {
    const storage = storageWith(
      JSON.stringify({
        mode: "dim",
        accentA: "blue",
        accentB: "#123",
        wordmarkFont: "comic-sans",
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

  it("preserves RGB and OKLCH accent colors", () => {
    const appearance = {
      accentA: "rgb(17 76 191)",
      accentB: "oklch(0.62 0.21 30)",
    };

    expect(loadAppSettings(storageWith(JSON.stringify(appearance)))).toEqual({
      ...DEFAULT_APP_SETTINGS,
      ...appearance,
    });
  });

  it("loads the dark mode accent adjustment preference", () => {
    expect(
      loadAppSettings(storageWith(JSON.stringify({ darkenAccentsInDarkMode: false }))),
    ).toEqual({
      ...DEFAULT_APP_SETTINGS,
      darkenAccentsInDarkMode: false,
    });
  });

  it("rejects malformed functional accent colors", () => {
    expect(
      loadAppSettings(
        storageWith(JSON.stringify({ accentA: "rgb(nope)", accentB: "oklch(blue)" })),
      ),
    ).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("saves app settings", () => {
    const storage = storageWith(null);
    const settings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      mode: "dark",
      accentA: "#90101a",
      accentB: "#00939a",
      wordmarkFont: "anton",
      syncTrackNumbers: false,
      syncFilenames: false,
      audioBitrate: "256",
      applySoundCloudAlbumCoverToTracks: false,
    };
    expect(saveAppSettings(settings, storage)).toBe(true);
    expect(storage.savedValue()).toBe(JSON.stringify(settings));
  });

  it("ignores app settings save failures", () => {
    const storage = {
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };
    expect(saveAppSettings(DEFAULT_APP_SETTINGS, storage)).toBe(false);
  });
});
