import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import TrackWaveformPreview from "@/features/editor/TrackWaveformPreview";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("track waveform transport", () => {
  it("does not fabricate caption tracks for user-provided music", () => {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(
        <TrackWaveformPreview file={undefined} fileId="" title="" fallbackDuration={0} active />,
      );
    });

    expect(renderer!.root.findAllByType("track")).toHaveLength(0);
    const waveform = renderer!.root.findByType("section");
    const scroller = renderer!.root.findByProps({ "data-waveform-scroller": true });
    const slider = renderer!.root.findByProps({ role: "slider" });

    expect(waveform.props.className).toContain("min-w-0");
    expect(waveform.props.className).toContain("w-full");
    expect(scroller.props.className).toContain("min-w-0");
    expect(scroller.props.className).toContain("w-full");
    expect(scroller.props.className).toContain("overflow-hidden");
    expect(scroller.props.className).not.toContain("border");
    expect(scroller.props.className).not.toContain("bg-");
    expect(slider.props.className).toContain("w-full");
    expect(slider.props.className).toContain("focus-visible:ring-inset");
    expect(slider.props.style).toBeUndefined();
    act(() => renderer!.unmount());
  });

  it("plays, seeks by pointer and keyboard, and cleans up without autoplaying a replacement", async () => {
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const url = `blob:preview-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => revokedUrls.push(url));
    class TestAudioContext {
      async decodeAudioData() {
        return {
          duration: 120,
          length: 4,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, 0.5, 1, 0.5]),
        };
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);

    const audio = {
      currentTime: 0,
      duration: 120,
      paused: true,
      src: "",
      load: vi.fn(),
      pause: vi.fn(() => {
        audio.paused = true;
      }),
      play: vi.fn(async () => {
        audio.paused = false;
      }),
      removeAttribute: vi.fn(() => {
        audio.src = "";
      }),
    };
    const firstFile = new File(["first"], "first.mp3", { type: "audio/mpeg" });
    const secondFile = new File(["second"], "second.mp3", { type: "audio/mpeg" });
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active
          file={firstFile}
          fileId="first"
          fallbackDuration={120}
          title="first"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });

    const getAudioElement = () => renderer!.root.findByType("audio");
    const getSlider = () => renderer!.root.findByProps({ role: "slider" });
    const getPlayButton = () => renderer!.root.findByProps({ "aria-label": "play preview" });

    await act(async () => {
      await getPlayButton().props.onClick();
      getAudioElement().props.onPlay();
    });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(renderer!.root.findByProps({ "aria-label": "pause preview" })).toBeDefined();

    act(() => {
      getSlider().props.onPointerDown({
        clientX: 150,
        pointerId: 1,
        pointerType: "mouse",
        currentTarget: {
          getBoundingClientRect: () => ({ left: 100, width: 200 }),
          setPointerCapture: vi.fn(),
        },
      });
    });
    expect(audio.currentTime).toBe(30);

    act(() => {
      getSlider().props.onKeyDown({ key: "ArrowRight", preventDefault: vi.fn() });
    });
    expect(audio.currentTime).toBe(35);

    act(() => {
      getSlider().props.onPointerDown({
        clientX: 100,
        pointerId: 2,
        pointerType: "touch",
        currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 200 }) },
      });
      getSlider().props.onPointerUp({
        clientX: 200,
        pointerType: "touch",
        currentTarget: { getBoundingClientRect: () => ({ left: 100, width: 200 }) },
      });
    });
    expect(audio.currentTime).toBe(60);

    await act(async () => {
      renderer!.root.findByProps({ "aria-label": "pause preview" }).props.onClick();
      getAudioElement().props.onPause();
    });
    expect(audio.pause).toHaveBeenCalled();

    await act(async () => {
      renderer!.update(
        <TrackWaveformPreview
          active
          file={secondFile}
          fileId="second"
          fallbackDuration={90}
          title="second"
        />,
      );
    });
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(revokedUrls).toContain("blob:preview-1");
    expect(renderer!.root.findByProps({ "aria-label": "play preview" })).toBeDefined();

    act(() => renderer!.unmount());
    expect(revokedUrls).toEqual(["blob:preview-1", "blob:preview-2"]);
  });

  it("blocks every seek path while the preview is inactive", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:inactive");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const audio = {
      currentTime: 12,
      paused: true,
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      removeAttribute: vi.fn(),
    };
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active={false}
          file={new File(["audio"], "inactive.mp3")}
          fileId="inactive"
          fallbackDuration={120}
          title="inactive"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });
    const slider = renderer!.root.findByProps({ role: "slider" });
    expect(slider.props["aria-disabled"]).toBe(true);
    expect(slider.props.className).toContain("cursor-not-allowed");
    audio.currentTime = 12;

    act(() => {
      slider.props.onPointerDown({ clientX: 150, pointerType: "mouse" });
      slider.props.onKeyDown({ key: "ArrowRight", preventDefault: vi.fn() });
    });
    expect(audio.currentTime).toBe(12);
    expect(audio.play).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("pauses and resets its play state as soon as an active preview becomes inactive", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:deactivated");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    class TestAudioContext {
      async decodeAudioData() {
        return {
          duration: 120,
          length: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([1]),
        };
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const audio = {
      currentTime: 0,
      paused: true,
      src: "",
      load: vi.fn(),
      pause: vi.fn(() => {
        audio.paused = true;
      }),
      play: vi.fn(async () => {
        audio.paused = false;
      }),
      removeAttribute: vi.fn(),
    };
    const file = new File(["audio"], "deactivated.mp3");
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active
          file={file}
          fileId="deactivated"
          fallbackDuration={120}
          title="deactivated"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });
    await act(async () => {
      await renderer!.root.findByProps({ "aria-label": "play preview" }).props.onClick();
      renderer!.root.findByType("audio").props.onPlay();
    });
    expect(renderer!.root.findByProps({ "aria-label": "pause preview" })).toBeDefined();
    audio.currentTime = 42;

    await act(async () => {
      renderer!.update(
        <TrackWaveformPreview
          active={false}
          file={file}
          fileId="deactivated"
          fallbackDuration={120}
          title="deactivated"
        />,
      );
    });
    expect(audio.pause).toHaveBeenCalled();
    expect(audio.currentTime).toBe(0);
    expect(renderer!.root.findByProps({ "aria-label": "play preview" })).toBeDefined();
    expect(renderer!.root.findByProps({ role: "slider" }).props["aria-disabled"]).toBe(true);
    act(() => renderer!.unmount());
  });

  it("resets an active A to B switch in layout phase before passive source cleanup", async () => {
    const phases: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => phases.push("revoke"));
    let decodeCount = 0;
    let resolveSecondDecode!: () => void;
    class TestAudioContext {
      decodeAudioData() {
        decodeCount += 1;
        const decoded = {
          duration: 60,
          length: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([1]),
        };
        if (decodeCount === 1) return Promise.resolve(decoded);
        return new Promise<typeof decoded>((resolve) => {
          resolveSecondDecode = () => resolve(decoded);
        });
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const audio = {
      currentTime: 0,
      paused: false,
      src: "",
      load: vi.fn(),
      pause: vi.fn(() => {
        phases.push("pause");
        audio.paused = true;
      }),
      play: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const firstFile = new File(["first"], "phase-first.mp3");
    const secondFile = new File(["second"], "phase-second.mp3");
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active
          file={firstFile}
          fileId="phase-first"
          fallbackDuration={60}
          title="first"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });
    act(() => {
      const audioElement = renderer!.root.findByType("audio");
      audioElement.props.onPlay();
      audioElement.props.onTimeUpdate({ currentTarget: { currentTime: 37 } });
    });
    expect(renderer!.root.findByProps({ role: "slider" }).props["aria-valuenow"]).toBe(37);
    phases.length = 0;

    await act(async () => {
      renderer!.update(
        <TrackWaveformPreview
          active
          file={secondFile}
          fileId="phase-second"
          fallbackDuration={60}
          title="second"
        />,
      );
    });

    expect(phases[0]).toBe("pause");
    expect(phases.indexOf("pause")).toBeLessThan(phases.indexOf("revoke"));
    expect(audio.currentTime).toBe(0);
    expect(renderer!.root.findByProps({ "aria-label": "play preview" })).toBeDefined();
    expect(renderer!.root.findByProps({ role: "slider" }).props["aria-valuenow"]).toBe(0);
    expect(renderer!.root.findByType("section").props["data-waveform-status"]).toBe("loading");
    expect(
      renderer!.root.findAll(
        (node) => node.type === "svg" && node.props.preserveAspectRatio === "none",
      ),
    ).toHaveLength(0);

    await act(async () => {
      resolveSecondDecode();
    });
    act(() => renderer!.unmount());
  });

  it("discards a deferred decode when the File changes under the same track id", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const decodeResolvers: Array<() => void> = [];
    class TestAudioContext {
      async decodeAudioData() {
        await new Promise<void>((resolve) => {
          decodeResolvers.push(resolve);
        });
        return {
          duration: 60,
          length: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([1]),
        };
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const audio = {
      currentTime: 0,
      paused: true,
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const firstFile = new File(["first"], "same-id-first.mp3");
    const secondFile = new File(["second"], "same-id-second.mp3");
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active
          file={firstFile}
          fileId="stable-id"
          fallbackDuration={60}
          title="first"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });
    await vi.waitFor(() => expect(decodeResolvers).toHaveLength(1));

    await act(async () => {
      renderer!.update(
        <TrackWaveformPreview
          active
          file={secondFile}
          fileId="stable-id"
          fallbackDuration={60}
          title="second"
        />,
      );
    });
    expect(renderer!.root.findByType("section").props["data-waveform-status"]).toBe("loading");
    expect(
      renderer!.root.findAll(
        (node) => node.type === "svg" && node.props.preserveAspectRatio === "none",
      ),
    ).toHaveLength(0);

    await act(async () => {
      decodeResolvers.shift()?.();
    });
    await vi.waitFor(() => expect(decodeResolvers).toHaveLength(1));
    expect(renderer!.root.findByType("section").props["data-waveform-status"]).toBe("loading");
    expect(
      renderer!.root.findAll(
        (node) => node.type === "svg" && node.props.preserveAspectRatio === "none",
      ),
    ).toHaveLength(0);

    await act(async () => {
      decodeResolvers.shift()?.();
    });
    expect(renderer!.root.findByType("section").props["data-waveform-status"]).toBe("ready");
    expect(
      renderer!.root.findAll(
        (node) => node.type === "svg" && node.props.preserveAspectRatio === "none",
      ),
    ).toHaveLength(2);
    act(() => renderer!.unmount());
  });

  it("marks missing media duration unavailable without constructing a decoder", async () => {
    vi.useFakeTimers();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unknown-duration");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const construct = vi.fn();
    class TestAudioContext {
      constructor() {
        construct();
      }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const audio = {
      currentTime: 0,
      paused: true,
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      removeAttribute: vi.fn(),
    };
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active
          file={new File(["audio"], "unknown-duration.mp3")}
          fileId="unknown-duration"
          fallbackDuration={0}
          title="unknown duration"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });
    expect(renderer!.root.findByType("section").props["data-waveform-status"]).toBe("loading");
    expect(construct).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(renderer!.root.findByType("section").props["data-waveform-status"]).toBe("unavailable");
    expect(construct).not.toHaveBeenCalled();
    act(() => renderer!.unmount());
  });

  it("never carries a known duration into a new unknown-duration file", async () => {
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => `blob:${(file as File).name}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const construct = vi.fn();
    class TestAudioContext {
      constructor() {
        construct();
      }

      async decodeAudioData() {
        return {
          duration: 60,
          length: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([1]),
        };
      }

      async close() {}
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const audio = {
      currentTime: 0,
      paused: true,
      src: "",
      load: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const knownFile = new File(["known"], "known.mp3");
    const unknownFile = new File(["unknown"], "unknown.mp3");
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TrackWaveformPreview
          active
          file={knownFile}
          fileId="known"
          fallbackDuration={60}
          title="known"
        />,
        { createNodeMock: (element) => (element.type === "audio" ? audio : null) },
      );
    });
    expect(construct).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer!.root.findByType("audio").props.onLoadedMetadata({
        currentTarget: { duration: 60 },
      });
    });
    expect(construct).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer!.update(
        <TrackWaveformPreview
          active
          file={unknownFile}
          fileId="unknown"
          fallbackDuration={0}
          title="unknown"
        />,
      );
    });
    expect(construct).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderer!.root.findByType("audio").props.onLoadedMetadata({
        currentTarget: { duration: 60 },
      });
    });
    expect(construct).toHaveBeenCalledTimes(2);
    act(() => renderer!.unmount());
  });
});
