import {
  ArrowRight,
  Download,
  FolderOpen,
  Headphones,
  Laptop,
  Music2,
  Smartphone,
  TabletSmartphone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ServiceKey = "spotify" | "apple" | "elsewhere";

export interface GuideImage {
  /** Put the file in public/listening-guide and use a path such as /listening-guide/example.png. */
  src: string;
  alt: string;
}

export interface GuideStep {
  title: string;
  body: string;
  icon: LucideIcon;
  image?: GuideImage;
}

export interface GuideRoute {
  id: string;
  service: ServiceKey;
  serviceLabel: string;
  destination: string;
  shortDestination: string;
  icon: LucideIcon;
  note?: string;
  intro: string;
  before: string;
  steps: GuideStep[];
  success: string;
  troubleshooting: string;
}

const downloadStep: GuideStep = {
  icon: Download,
  title: "get the files from tagium",
  body: "download the finished track or library. if you downloaded more than one track, extract the zip so you can see the mp3 files.",
};

export const guideRoutes: GuideRoute[] = [
  {
    id: "spotify-desktop",
    service: "spotify",
    serviceLabel: "spotify",
    destination: "a computer",
    shortDestination: "computer",
    icon: Laptop,
    intro: "this page starts with the files already downloaded to your current device.",
    before: "have spotify installed and know where tagium saved the downloaded mp3 files.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "add them to spotify",
        body: "open spotify on your computer and add the mp3 files using its local files settings.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open your library in spotify and find the local files area. the tracks should appear after spotify finishes reading them.",
      },
    ],
    success: "the tracks appear in spotify with the titles and artwork you set in tagium.",
    troubleshooting:
      "check that local files are enabled and that spotify can reach the folder containing the mp3 files.",
  },
  {
    id: "spotify-iphone",
    service: "spotify",
    serviceLabel: "spotify",
    destination: "an iphone or ipad",
    shortDestination: "iphone / ipad",
    icon: TabletSmartphone,
    intro:
      "this path starts on the computer where your tagium downloads are saved, then moves the music to your iphone or ipad.",
    before:
      "have a computer, spotify, and your iphone or ipad ready. keep the devices connected or nearby while the music moves.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "prepare them in spotify",
        body: "open spotify on the computer and add the mp3 files to your local files.",
      },
      {
        icon: ArrowRight,
        title: "move them to your iphone or ipad",
        body: "use spotify’s local-file sync to download the music to your iphone or ipad.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open spotify on your iphone or ipad and find the local files area after the sync finishes.",
      },
    ],
    success: "the tracks appear in spotify with the titles and artwork you set in tagium.",
    troubleshooting:
      "check that local files are enabled, both devices are available to each other, and the same spotify account is signed in.",
  },
  {
    id: "spotify-android",
    service: "spotify",
    serviceLabel: "spotify",
    destination: "an android phone",
    shortDestination: "android",
    icon: Smartphone,
    intro:
      "this path starts on the computer where your tagium downloads are saved, then moves the music to your android phone.",
    before:
      "have a computer, spotify, and your android phone ready. keep the devices connected or nearby while the music moves.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "prepare them in spotify",
        body: "open spotify on the computer and add the mp3 files to your local files.",
      },
      {
        icon: ArrowRight,
        title: "move them to android",
        body: "use spotify’s local-file sync to download the music to your android phone.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open spotify on your phone and find the local files area after the sync finishes.",
      },
    ],
    success: "the tracks appear in spotify with the titles and artwork you set in tagium.",
    troubleshooting:
      "check that local files are enabled, both devices are available to each other, and the same spotify account is signed in.",
  },
  {
    id: "apple-mac",
    service: "apple",
    serviceLabel: "apple music",
    destination: "a mac",
    shortDestination: "mac",
    icon: Laptop,
    intro: "this page starts with the files already downloaded to your mac.",
    before: "have the music app ready and know where tagium saved the downloaded mp3 files.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "add them to apple music",
        body: "open the music app on your mac and import the mp3 files into your library.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open recently added or songs in the music app after it finishes importing the files.",
      },
    ],
    success: "the tracks appear in apple music with the titles and artwork you set in tagium.",
    troubleshooting:
      "check that the files finished importing and that the music app can reach the folder containing the mp3 files.",
  },
  {
    id: "apple-windows",
    service: "apple",
    serviceLabel: "apple music",
    destination: "a windows computer",
    shortDestination: "windows",
    icon: Laptop,
    intro: "this page starts with the files already downloaded to your windows computer.",
    before: "have apple music installed and know where tagium saved the downloaded mp3 files.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "add them to apple music",
        body: "open apple music on your computer and import the mp3 files into your library.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open recently added or songs in apple music after it finishes importing the files.",
      },
    ],
    success: "the tracks appear in apple music with the titles and artwork you set in tagium.",
    troubleshooting:
      "check that the files finished importing and that apple music can reach the folder containing the mp3 files.",
  },
  {
    id: "apple-iphone-sync",
    service: "apple",
    serviceLabel: "apple music",
    destination: "an iphone or ipad",
    shortDestination: "iphone / ipad",
    icon: TabletSmartphone,
    note: "with sync library",
    intro:
      "this path starts on the computer where your tagium downloads are saved, then syncs the music to your iphone or ipad.",
    before:
      "have a computer, apple music, and your iphone or ipad ready. make sure sync library is enabled on both devices.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "add them to apple music",
        body: "import the mp3 files into apple music on your computer.",
      },
      {
        icon: ArrowRight,
        title: "sync them to your iphone or ipad",
        body: "leave apple music open while sync library uploads the tracks and makes them available on your device.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open the music app on your iphone or ipad and find the tracks in recently added or songs.",
      },
    ],
    success: "the tracks appear in apple music with the titles and artwork you set in tagium.",
    troubleshooting:
      "check that sync library is enabled and that the same apple account is signed in on both devices.",
  },
  {
    id: "apple-iphone-manual",
    service: "apple",
    serviceLabel: "apple music",
    destination: "an iphone or ipad",
    shortDestination: "iphone / ipad",
    icon: TabletSmartphone,
    note: "without a subscription",
    intro:
      "this path starts on the computer where your tagium downloads are saved, then copies the music to your iphone or ipad.",
    before:
      "have a computer, apple music, a cable, and your iphone or ipad ready before you begin.",
    steps: [
      downloadStep,
      {
        icon: Music2,
        title: "add them to your music library",
        body: "import the mp3 files into the music library on your computer.",
      },
      {
        icon: ArrowRight,
        title: "copy them to your iphone or ipad",
        body: "connect your device and use the computer’s device-sync controls to copy the selected music.",
      },
      {
        icon: Headphones,
        title: "find and play them",
        body: "open the music app on your iphone or ipad after the copy finishes and find the tracks in your library.",
      },
    ],
    success: "the tracks appear in the music app with the titles and artwork you set in tagium.",
    troubleshooting:
      "check the cable connection, confirm that the device trusts the computer, and run the music sync again.",
  },
  {
    id: "elsewhere",
    service: "elsewhere",
    serviceLabel: "anywhere else",
    destination: "somewhere else",
    shortDestination: "another place",
    icon: FolderOpen,
    intro: "follow these steps from the device where your tagium downloads are saved.",
    before: "know where the downloads are saved and have the destination ready to receive files.",
    steps: [
      {
        icon: Download,
        title: "download the mp3s",
        body: "download a track or your whole library from tagium. if you downloaded a zip, extract it before you continue.",
      },
      {
        icon: FolderOpen,
        title: "find the files",
        body: "keep the mp3 files somewhere easy to find, such as your downloads or music folder.",
      },
      {
        icon: ArrowRight,
        title: "move a copy",
        body: "connect or open your destination, then copy the mp3 files across. wait for the transfer to finish before disconnecting anything.",
      },
      {
        icon: Headphones,
        title: "open them there",
        body: "use the destination’s normal file or music browser to find the mp3s and play one.",
      },
    ],
    success: "the copied files open and play away from the original device.",
    troubleshooting:
      "check that the transfer finished and that the destination can read mp3 files. try opening one file directly.",
  },
];
