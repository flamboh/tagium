"use client";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useState, useCallback } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import AlbumMetadataDialog, { AlbumMetadataDraft } from "./AlbumMetadataDialog";
import DeleteConfirmationDialog from "./DeleteConfirmationDialog";
import {
  createAlbumFromTracks,
  mergeUploadedTracksIntoAlbums,
  moveTracksInSidebar,
  removeTracksFromAlbums,
  updateAlbumMetadata,
  reorderAlbums,
} from "./albumOps";
import {
  applyAlbumSharedTagsToFiles,
  applyTrackOrderNumbersToFiles,
} from "./fileMetadataOps";
import TagSidebarPanel from "./TagSidebarPanel";
import TrackMetadataEditor from "./TrackMetadataEditor";
import {
  parseUploadedTracks,
  toGenreString,
  writeMetadataToFile,
} from "./mp3Utils";
import { AlbumGroup, AudioMetadata, TagiumFile } from "./types";
const EMPTY_ALBUM_DRAFT: AlbumMetadataDraft = {
  title: "",
  artist: "",
  genre: "",
  cover: undefined,
  syncTrackNumbers: false,
};

type PendingDeletion =
  | {
      type: "tracks";
      trackIds: string[];
    }
  | {
      type: "album";
      albumId: string;
    };

interface TrackDragPayload {
  trackIds: string[];
  anchorTrackId: string;
  allLoose: boolean;
}

const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];
export default function AudioTagger() {
  const [files, setFiles] = useState<TagiumFile[]>([]);
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  const [looseTrackIds, setLooseTrackIds] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [albumDialogOpen, setAlbumDialogOpen] = useState(false);
  const [albumDialogMode, setAlbumDialogMode] = useState<"create" | "edit">(
    "create"
  );
  const [albumDraft, setAlbumDraft] = useState<AlbumMetadataDraft>(
    EMPTY_ALBUM_DRAFT
  );
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);
  const [createSeedTrackIds, setCreateSeedTrackIds] = useState<string[]>([]);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const { register, handleSubmit, control, setValue, reset } =
    useForm<AudioMetadata>();
  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId]
  );
  const sidebarTrackOrder = useMemo(
    () => [...looseTrackIds, ...albums.flatMap((album) => album.trackIds)],
    [albums, looseTrackIds]
  );
  const orderTrackIdsBySidebar = useCallback(
    (trackIds: Iterable<string>) => {
      const trackIdSet = new Set(trackIds);
      return sidebarTrackOrder.filter((trackId) => trackIdSet.has(trackId));
    },
    [sidebarTrackOrder]
  );
  const closeDeleteDialog = useCallback(() => {
    setPendingDeletion(null);
  }, []);
  const deleteTracks = useCallback(
    (trackIds: Iterable<string>) => {
      const orderedTrackIds = orderTrackIdsBySidebar(trackIds);
      if (orderedTrackIds.length === 0) return;

      const trackIdSet = new Set(orderedTrackIds);
      setFiles((prevFiles) => prevFiles.filter((file) => !trackIdSet.has(file.id)));
      setAlbums((prevAlbums) => removeTracksFromAlbums(prevAlbums, orderedTrackIds));
      setLooseTrackIds((prevLooseTrackIds) =>
        prevLooseTrackIds.filter((trackId) => !trackIdSet.has(trackId))
      );
      setSelectedFileIds(
        (prevSelectedFileIds) =>
          new Set([...prevSelectedFileIds].filter((trackId) => !trackIdSet.has(trackId)))
      );

      if (selectedFileId && trackIdSet.has(selectedFileId)) {
        setSelectedFileId(null);
      }
      if (lastSelectedFileId && trackIdSet.has(lastSelectedFileId)) {
        setLastSelectedFileId(null);
      }
    },
    [lastSelectedFileId, orderTrackIdsBySidebar, selectedFileId]
  );
  const deleteAlbum = useCallback(
    (albumId: string) => {
      const albumToRemove = albums.find((album) => album.id === albumId);
      if (!albumToRemove) return;

      const trackIdSet = new Set(albumToRemove.trackIds);
      setFiles((prevFiles) => prevFiles.filter((file) => !trackIdSet.has(file.id)));
      setAlbums((prevAlbums) => prevAlbums.filter((album) => album.id !== albumId));
      setLooseTrackIds((prevLooseTrackIds) =>
        prevLooseTrackIds.filter((trackId) => !trackIdSet.has(trackId))
      );
      setSelectedFileIds(
        (prevSelectedFileIds) =>
          new Set([...prevSelectedFileIds].filter((trackId) => !trackIdSet.has(trackId)))
      );

      if (selectedFileId && trackIdSet.has(selectedFileId)) {
        setSelectedFileId(null);
      }
      if (lastSelectedFileId && trackIdSet.has(lastSelectedFileId)) {
        setLastSelectedFileId(null);
      }
      if (selectedAlbumId === albumId) {
        setSelectedAlbumId(null);
      }
      if (editingAlbumId === albumId) {
        setAlbumDialogOpen(false);
      }
    },
    [albums, editingAlbumId, lastSelectedFileId, selectedAlbumId, selectedFileId]
  );
  const requestTrackDeletion = useCallback(
    (trackIds: Iterable<string>) => {
      const orderedTrackIds = orderTrackIdsBySidebar(trackIds);
      if (orderedTrackIds.length === 0) return;
      setPendingDeletion({
        type: "tracks",
        trackIds: orderedTrackIds,
      });
    },
    [orderTrackIdsBySidebar]
  );
  const requestAlbumDeletion = useCallback(
    (albumId: string) => {
      const albumToRemove = albums.find((album) => album.id === albumId);
      if (!albumToRemove) return;
      setPendingDeletion({
        type: "album",
        albumId,
      });
    },
    [albums]
  );
  const confirmPendingDeletion = useCallback(() => {
    if (!pendingDeletion) return;

    if (pendingDeletion.type === "tracks") {
      deleteTracks(pendingDeletion.trackIds);
    } else {
      deleteAlbum(pendingDeletion.albumId);
    }

    setPendingDeletion(null);
  }, [deleteAlbum, deleteTracks, pendingDeletion]);
  const deleteDialogConfig = useMemo(() => {
    if (!pendingDeletion) return null;

    if (pendingDeletion.type === "tracks") {
      if (pendingDeletion.trackIds.length === 1) {
        const track = files.find((file) => file.id === pendingDeletion.trackIds[0]);
        const filename = track?.filename ?? "this track";
        return {
          title: `delete ${filename}?`,
          description: "This removes the track from the current library.",
          confirmLabel: "delete track",
        };
      }

      return {
        title: `delete ${pendingDeletion.trackIds.length} tracks?`,
        description: "This removes the selected tracks from the current library.",
        confirmLabel: "delete tracks",
      };
    }

    const album = albums.find((entry) => entry.id === pendingDeletion.albumId);
    if (!album) return null;

    return {
      title: `delete ${album.title}?`,
      description: `This removes the album and its ${album.trackIds.length} track${
        album.trackIds.length === 1 ? "" : "s"
      } from the current library.`,
      confirmLabel: "delete album",
    };
  }, [albums, files, pendingDeletion]);
  useLayoutEffect(() => {
    if (selectedFile?.metadata) {
      reset(selectedFile.metadata);
    }
  }, [selectedFile, reset]);
  useEffect(() => {
    const fileIdSet = new Set(files.map((file) => file.id));
    setLooseTrackIds((prevLooseTrackIds) =>
      prevLooseTrackIds.filter((trackId) => fileIdSet.has(trackId))
    );
  }, [files]);
  useEffect(() => {
    const hasSelectedAlbum =
      !!selectedAlbumId && albums.some((album) => album.id === selectedAlbumId);
    const hasSelectedFile =
      !!selectedFileId && files.some((file) => file.id === selectedFileId);
    const isManuallyDeselected =
      selectedAlbumId === null && selectedFileId === null;
    if (isManuallyDeselected) {
      return;
    }
    if (hasSelectedFile) {
      return;
    }
    if (!selectedFileId && hasSelectedAlbum) {
      return;
    }
    if (looseTrackIds.length > 0 && !hasSelectedAlbum) {
      setSelectedAlbumId(null);
      setSelectedFileId(looseTrackIds[0]);
      return;
    }
    const firstAlbumWithTrack = albums.find((album) => album.trackIds.length > 0);
    if (firstAlbumWithTrack) {
      setSelectedAlbumId(firstAlbumWithTrack.id);
      setSelectedFileId(firstAlbumWithTrack.trackIds[0]);
      return;
    }
    setSelectedFileId(null);
    setSelectedAlbumId(null);
  }, [albums, files, looseTrackIds, selectedAlbumId, selectedFileId]);
  
  const handleTagUpdate = async (
    fileToUpdate: TagiumFile,
    newTags: AudioMetadata
  ) => {
    try {
      const updatedFile = await writeMetadataToFile(fileToUpdate, newTags);
      setFiles((prevFiles) =>
        prevFiles.map((file) =>
          file.id === fileToUpdate.id
            ? {
                ...file,
                file: updatedFile,
                filename: updatedFile.name,
                metadata: {
                  ...newTags,
                  year: Number.isNaN(newTags.year as number)
                    ? undefined
                    : newTags.year,
                  trackNumber: Number.isNaN(newTags.trackNumber as number)
                    ? undefined
                    : newTags.trackNumber,
                  duration: file.metadata?.duration || 0,
                  bitrate: file.metadata?.bitrate || 0,
                  sampleRate: file.metadata?.sampleRate || 0,
                  picture: newTags.picture || [],
                },
                status: "saved",
              }
            : file
        )
      );
    } catch (error) {
      setFiles((prevFiles) =>
        prevFiles.map((file) =>
          file.id === fileToUpdate.id ? { ...file, status: "error" } : file
        )
      );
      throw error;
    }
  };
  const onSubmit: SubmitHandler<AudioMetadata> = async (data) => {
    if (!selectedFile) return;
    try {
      await handleTagUpdate(selectedFile, data);
    } catch (error) {
      console.error("Failed to update tags:", error);
    }
  };
  const handleAudioUpload = async (
    uploadedFiles: File[],
    targetAlbumId?: string
  ) => {
    setLoading(true);
    try {
      const parsedUploads = await parseUploadedTracks(uploadedFiles);
      if (parsedUploads.length === 0) return;
      setFiles((prevFiles) => [
        ...prevFiles,
        ...parsedUploads.map((upload) => upload.file),
      ]);
      const hasTargetAlbum = Boolean(
        targetAlbumId && albums.some((album) => album.id === targetAlbumId)
      );
      const forceSingleAlbum = !hasTargetAlbum && parsedUploads.length > 1;
      let firstSelectedAlbumId: string | null = null;
      if (hasTargetAlbum && targetAlbumId) {
        const uploadedTrackIds = parsedUploads.map((upload) => upload.file.id);
        let nextAlbums: AlbumGroup[] = [];
        setAlbums((prevAlbums) => {
          nextAlbums = prevAlbums.map((album) =>
            album.id === targetAlbumId
              ? { ...album, trackIds: [...album.trackIds, ...uploadedTrackIds] }
              : album
          );
          return nextAlbums;
        });
        const targetAlbum = nextAlbums.find((album) => album.id === targetAlbumId);
        if (targetAlbum) {
          setFiles((prevFiles) => applyAlbumSharedTagsToFiles(prevFiles, targetAlbum));
          if (targetAlbum.syncTrackNumbers) {
            setFiles((prevFiles) =>
              applyTrackOrderNumbersToFiles(prevFiles, nextAlbums, [targetAlbumId])
            );
          }
        }
        setSelectedFileId(parsedUploads[0].file.id);
        setSelectedAlbumId(targetAlbumId);
      } else {
        setAlbums((prevAlbums) => {
          const merged = mergeUploadedTracksIntoAlbums(prevAlbums, parsedUploads, {
            forceSingleAlbum,
          });
          firstSelectedAlbumId = merged.firstSelectedAlbumId;
          if (!forceSingleAlbum && merged.unassignedTrackIds.length > 0) {
            setLooseTrackIds((prevLooseTrackIds) => [
              ...prevLooseTrackIds,
              ...merged.unassignedTrackIds,
            ]);
          }
          return merged.albums;
        });
        const firstUploadedTrack = parsedUploads[0];
        const firstTrackIsLoose =
          !forceSingleAlbum && !firstUploadedTrack.albumSeed.title.trim();
        setSelectedFileId(firstUploadedTrack.file.id);
        setSelectedAlbumId(firstTrackIsLoose ? null : firstSelectedAlbumId);
      }
    } finally {
      setLoading(false);
    }
  };
  const handleSaveAll = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      for (const file of files) {
        if (file.metadata) {
          await handleTagUpdate(file, file.metadata);
        }
      }
    } catch (error) {
      console.error("Error saving all files:", error);
    } finally {
      setLoading(false);
    }
  };
  const handleTrackCoverUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const uint8Array = new Uint8Array(arrayBuffer);
      setValue("picture", [
        {
          format: file.type,
          type: 3,
          data: uint8Array,
          description: "Uploaded cover",
        },
      ]);
    };
    reader.readAsArrayBuffer(file);
  };
  const handleDownloadUpdatedFile = (file: TagiumFile) => {
    const url = URL.createObjectURL(file.file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const handleRemoveFile = (idToRemove: string) => {
    requestTrackDeletion([idToRemove]);
  };
  const handleRemoveAlbum = (albumId: string) => {
    requestAlbumDeletion(albumId);
  };
  const handleSelectAlbum = (albumId: string, event?: ReactMouseEvent) => {
    const isMultiSelect = event?.ctrlKey || event?.metaKey;
    
    if (isMultiSelect) {
      setSelectedAlbumId(albumId);
      const album = albums.find((entry) => entry.id === albumId);
      const firstTrackId = album?.trackIds[0];
      if (firstTrackId) {
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          if (next.has(firstTrackId)) {
            next.delete(firstTrackId);
          } else {
            next.add(firstTrackId);
          }
          return next;
        });
        setSelectedFileId(firstTrackId);
        setLastSelectedFileId(firstTrackId);
      }
    } else {
      setSelectedAlbumId(albumId);
      const album = albums.find((entry) => entry.id === albumId);
      const firstTrackId = album?.trackIds[0] ?? null;
      setSelectedFileId(firstTrackId);
      setSelectedFileIds(firstTrackId ? new Set([firstTrackId]) : new Set());
      setLastSelectedFileId(firstTrackId);
    }
  };
  
  const handleSelectFile = (albumId: string, fileId: string, event?: ReactMouseEvent) => {
    const isMultiSelect = event?.ctrlKey || event?.metaKey;
    const isRangeSelect = event?.shiftKey && lastSelectedFileId;
    
    if (isRangeSelect) {
      const album = albums.find((entry) => entry.id === albumId);
      if (!album) return;
      const trackIds = album.trackIds;
      const startIndex = trackIds.indexOf(lastSelectedFileId);
      const endIndex = trackIds.indexOf(fileId);
      if (startIndex >= 0 && endIndex >= 0) {
        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);
        const rangeIds = trackIds.slice(minIndex, maxIndex + 1);
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((id) => next.add(id));
          return next;
        });
        setSelectedFileId(fileId);
        setLastSelectedFileId(fileId);
      }
    } else if (isMultiSelect) {
      setSelectedAlbumId(albumId);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        return next;
      });
      setSelectedFileId(fileId);
      setLastSelectedFileId(fileId);
    } else {
      setSelectedAlbumId(albumId);
      setSelectedFileId(fileId);
      setSelectedFileIds(new Set([fileId]));
      setLastSelectedFileId(fileId);
    }
  };
  
  const handleSelectLooseTrack = (fileId: string, event?: ReactMouseEvent) => {
    const isMultiSelect = event?.ctrlKey || event?.metaKey;
    const isRangeSelect = event?.shiftKey && lastSelectedFileId;
    
    if (isRangeSelect) {
      const startIndex = looseTrackIds.indexOf(lastSelectedFileId);
      const endIndex = looseTrackIds.indexOf(fileId);
      if (startIndex >= 0 && endIndex >= 0) {
        const minIndex = Math.min(startIndex, endIndex);
        const maxIndex = Math.max(startIndex, endIndex);
        const rangeIds = looseTrackIds.slice(minIndex, maxIndex + 1);
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          rangeIds.forEach((id) => next.add(id));
          return next;
        });
        setSelectedFileId(fileId);
        setLastSelectedFileId(fileId);
      }
    } else if (isMultiSelect) {
      setSelectedAlbumId(null);
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(fileId)) {
          next.delete(fileId);
        } else {
          next.add(fileId);
        }
        return next;
      });
      setSelectedFileId(fileId);
      setLastSelectedFileId(fileId);
    } else {
      setSelectedAlbumId(null);
      setSelectedFileId(fileId);
      setSelectedFileIds(new Set([fileId]));
      setLastSelectedFileId(fileId);
    }
  };
  
  const handleClearSelection = useCallback(() => {
    setSelectedAlbumId(null);
    setSelectedFileId(null);
    setSelectedFileIds(new Set());
    setLastSelectedFileId(null);
  }, []);
  
  const handleRemoveSelectedFiles = useCallback(
    ({ skipConfirmation = false }: { skipConfirmation?: boolean } = {}) => {
      const selectedTrackIds = orderTrackIdsBySidebar(selectedFileIds);
      if (selectedTrackIds.length === 0) return;

      if (skipConfirmation) {
        deleteTracks(selectedTrackIds);
        return;
      }

      requestTrackDeletion(selectedTrackIds);
    },
    [deleteTracks, orderTrackIdsBySidebar, requestTrackDeletion, selectedFileIds]
  );
  
  const handleSelectAllFiles = useCallback(() => {
    const allFileIds = new Set(files.map((file) => file.id));
    setSelectedFileIds(allFileIds);
    if (files.length > 0) {
      setSelectedFileId(files[0].id);
      setLastSelectedFileId(files[0].id);
    }
  }, [files]);
  
  const handleReorderAlbums = (albumId: string, targetIndex: number) => {
    setAlbums((prevAlbums) => reorderAlbums(prevAlbums, albumId, targetIndex));
  };
  const handleStartTrackDrag = useCallback(
    (trackId: string, source: "album" | "loose", albumId?: string): TrackDragPayload => {
      const dragTrackIds = selectedFileIds.has(trackId)
        ? orderTrackIdsBySidebar(selectedFileIds)
        : [trackId];

      setSelectedFileIds(new Set(dragTrackIds));
      setSelectedFileId(trackId);
      setLastSelectedFileId(trackId);
      setSelectedAlbumId(source === "album" ? albumId ?? null : null);

      const looseTrackIdSet = new Set(looseTrackIds);
      return {
        trackIds: dragTrackIds,
        anchorTrackId: trackId,
        allLoose: dragTrackIds.every((id) => looseTrackIdSet.has(id)),
      };
    },
    [looseTrackIds, orderTrackIdsBySidebar, selectedFileIds]
  );
  
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pendingDeletion) {
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (isInputFocused) {
        return;
      }
      
      if (isModifierPressed && event.key.toLowerCase() === "a") {
        event.preventDefault();
        handleSelectAllFiles();
        return;
      }
      
      if (event.key === "Delete") {
        if (selectedFileIds.size > 0) {
          event.preventDefault();
          handleRemoveSelectedFiles({ skipConfirmation: event.shiftKey });
          return;
        }
      }
      
      if (event.key === "Escape") {
        handleClearSelection();
        return;
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleClearSelection,
    handleRemoveSelectedFiles,
    handleSelectAllFiles,
    pendingDeletion,
    selectedFileIds,
  ]);
  
  const openCreateAlbumDialog = (seedTrackIds: string[]) => {
    const uniqueSeedTrackIds = asUniqueTrackIds(seedTrackIds);
    const seedTrack = files.find((file) => file.id === uniqueSeedTrackIds[0]);
    const albumCount = albums.filter((album) => /^Album\s\d+$/i.test(album.title)).length;
    setAlbumDialogMode("create");
    setEditingAlbumId(null);
    setCreateSeedTrackIds(uniqueSeedTrackIds);
    setAlbumDraft({
      title:
        uniqueSeedTrackIds.length > 0
          ? seedTrack?.metadata?.album?.trim() || `Album ${albumCount + 1}`
          : `Album ${albumCount + 1}`,
      artist: uniqueSeedTrackIds.length > 0 ? seedTrack?.metadata?.artist || "" : "",
      genre: uniqueSeedTrackIds.length > 0 ? toGenreString(seedTrack?.metadata?.genre) : "",
      cover:
        uniqueSeedTrackIds.length > 0 &&
        seedTrack?.metadata?.picture &&
        seedTrack.metadata.picture.length > 0
          ? seedTrack.metadata.picture
          : undefined,
      syncTrackNumbers: false,
    });
    setAlbumDialogOpen(true);
  };
  const handleOpenCreateAlbumDialog = () => {
    openCreateAlbumDialog([]);
  };
  const handlePromptCreateAlbumFromLooseTracks = (trackIds: string[]) => {
    const idSet = new Set(trackIds);
    const orderedIds = looseTrackIds.filter((trackId) => idSet.has(trackId));
    if (orderedIds.length < 2) return;
    openCreateAlbumDialog(orderedIds);
  };
  const handleOpenEditAlbumDialog = (albumId: string) => {
    const album = albums.find((entry) => entry.id === albumId);
    if (!album) return;
    setAlbumDialogMode("edit");
    setEditingAlbumId(albumId);
    setCreateSeedTrackIds([]);
    setAlbumDraft({
      title: album.title,
      artist: album.artist,
      genre: album.genre,
      cover: album.cover,
      syncTrackNumbers: album.syncTrackNumbers,
    });
    setAlbumDialogOpen(true);
  };
  const closeAlbumDialog = () => {
    setAlbumDialogOpen(false);
  };
  const saveAlbumDialog = () => {
    const title = albumDraft.title.trim() || "Untitled Album";
    const artist = albumDraft.artist.trim();
    const genre = albumDraft.genre.trim();
    const metadata = {
      title,
      artist,
      genre,
      cover: albumDraft.cover,
      syncTrackNumbers: albumDraft.syncTrackNumbers,
    };
    if (albumDialogMode === "edit" && editingAlbumId) {
      const updatedAlbums = updateAlbumMetadata(albums, editingAlbumId, metadata);
      setAlbums(updatedAlbums);
      const updatedAlbum =
        updatedAlbums.find((album) => album.id === editingAlbumId) ?? null;
      if (updatedAlbum) {
        setFiles((prevFiles) => applyAlbumSharedTagsToFiles(prevFiles, updatedAlbum));
      }
      closeAlbumDialog();
      return;
    }
    if (albumDialogMode === "create") {
      const created = createAlbumFromTracks(
        albums,
        looseTrackIds,
        createSeedTrackIds,
        metadata
      );
      setAlbums(created.albums);
      setLooseTrackIds(created.looseTrackIds);
      if (created.syncAlbums.length > 0) {
        setFiles((prevFiles) =>
          applyTrackOrderNumbersToFiles(prevFiles, created.albums, created.syncAlbums)
        );
      }
      if (created.newAlbumId) {
        setSelectedAlbumId(created.newAlbumId);
        setSelectedFileId(createSeedTrackIds[0] ?? null);
        const createdAlbum = created.albums.find(
          (album) => album.id === created.newAlbumId
        );
        if (createdAlbum) {
          setFiles((prevFiles) => applyAlbumSharedTagsToFiles(prevFiles, createdAlbum));
        }
      }
    }
    closeAlbumDialog();
  };
  const handleMoveTracksToAlbum = (
    trackIds: string[],
    anchorTrackId: string,
    targetAlbumId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string
  ) => {
    const orderedTrackIds = orderTrackIdsBySidebar(trackIds);
    const moved = moveTracksInSidebar(
      albums,
      looseTrackIds,
      orderedTrackIds,
      placement === "append" || !referenceTrackId
        ? {
            type: "album",
            albumId: targetAlbumId,
            placement: "append",
          }
        : {
            type: "album",
            albumId: targetAlbumId,
            placement,
            referenceTrackId,
          }
    );
    setAlbums(moved.albums);
    setLooseTrackIds(moved.looseTrackIds);
    setSelectedAlbumId(targetAlbumId);
    setSelectedFileIds(new Set(orderedTrackIds));
    setSelectedFileId(anchorTrackId);
    setLastSelectedFileId(anchorTrackId);
    if (moved.albumsToSync.length > 0) {
      setFiles((prevFiles) =>
        applyTrackOrderNumbersToFiles(prevFiles, moved.albums, moved.albumsToSync)
      );
    }
  };
  const handleMoveTracksToLoose = (
    trackIds: string[],
    anchorTrackId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string
  ) => {
    const orderedTrackIds = orderTrackIdsBySidebar(trackIds);
    const moved = moveTracksInSidebar(
      albums,
      looseTrackIds,
      orderedTrackIds,
      placement === "append" || !referenceTrackId
        ? {
            type: "loose",
            placement: "append",
          }
        : {
            type: "loose",
            placement,
            referenceTrackId,
          }
    );
    setAlbums(moved.albums);
    setLooseTrackIds(moved.looseTrackIds);
    setSelectedAlbumId(null);
    setSelectedFileIds(new Set(orderedTrackIds));
    setSelectedFileId(anchorTrackId);
    setLastSelectedFileId(anchorTrackId);
    if (moved.albumsToSync.length > 0) {
      setFiles((prevFiles) =>
        applyTrackOrderNumbersToFiles(prevFiles, moved.albums, moved.albumsToSync)
      );
    }
  };
  return (
    <>
      <DeleteConfirmationDialog
        open={Boolean(deleteDialogConfig)}
        title={deleteDialogConfig?.title ?? ""}
        description={deleteDialogConfig?.description ?? ""}
        confirmLabel={deleteDialogConfig?.confirmLabel ?? "delete"}
        onClose={closeDeleteDialog}
        onConfirm={confirmPendingDeletion}
      />
      <AlbumMetadataDialog
        open={albumDialogOpen}
        mode={albumDialogMode}
        draft={albumDraft}
        onChange={setAlbumDraft}
        onClose={closeAlbumDialog}
        onSave={saveAlbumDialog}
      />
      <div className="w-full max-w-7xl flex gap-4 min-h-[85vh]">
        <TagSidebarPanel
          loading={loading}
          files={files}
          albums={albums}
          looseTrackIds={looseTrackIds}
          selectedAlbumId={selectedAlbumId}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          onAudioUpload={handleAudioUpload}
          onSelectAlbum={handleSelectAlbum}
          onSelectFile={handleSelectFile}
          onSelectLooseTrack={handleSelectLooseTrack}
          onClearSelection={handleClearSelection}
          onRemoveFile={handleRemoveFile}
          onRemoveAlbum={handleRemoveAlbum}
          onAddAlbum={handleOpenCreateAlbumDialog}
          onEditAlbum={handleOpenEditAlbumDialog}
          onUploadToAlbum={(albumId, filesToUpload) =>
            handleAudioUpload(filesToUpload, albumId)
          }
          onMoveTracksToAlbum={handleMoveTracksToAlbum}
          onMoveTracksToLoose={handleMoveTracksToLoose}
          onPromptCreateAlbumFromLooseTracks={
            handlePromptCreateAlbumFromLooseTracks
          }
          onReorderAlbums={handleReorderAlbums}
          onStartTrackDrag={handleStartTrackDrag}
          onSaveAll={handleSaveAll}
        />
        <div className="flex-1 flex flex-col">
          <TrackMetadataEditor
            selectedFile={selectedFile}
            selectedFileId={selectedFileId}
            register={register}
            control={control}
            handleSubmit={handleSubmit}
            onSubmit={onSubmit}
            onTrackCoverUpload={handleTrackCoverUpload}
            onDownloadUpdatedFile={handleDownloadUpdatedFile}
            onAudioUpload={handleAudioUpload}
          />
        </div>
      </div>
    </>
  );
}
