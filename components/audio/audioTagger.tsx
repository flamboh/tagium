"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { SubmitHandler, useForm } from "react-hook-form";
import AlbumMetadataDialog, { AlbumMetadataDraft } from "./AlbumMetadataDialog";
import {
  createAlbumFromTracks,
  mergeUploadedTracksIntoAlbums,
  moveTrackInSidebar,
  removeTrackFromAlbums,
  updateAlbumMetadata,
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

const asUniqueTrackIds = (trackIds: string[]) => [...new Set(trackIds)];

export default function AudioTagger() {
  const [files, setFiles] = useState<TagiumFile[]>([]);
  const [albums, setAlbums] = useState<AlbumGroup[]>([]);
  const [looseTrackIds, setLooseTrackIds] = useState<string[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
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

  const { register, handleSubmit, control, setValue, reset } =
    useForm<AudioMetadata>();

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId]
  );

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
    if (selectedFileId && files.some((file) => file.id === selectedFileId)) {
      return;
    }

    if (looseTrackIds.length > 0) {
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
  }, [albums, files, looseTrackIds, selectedFileId]);

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

  const handleAudioUpload = async (uploadedFiles: File[]) => {
    setLoading(true);

    try {
      const parsedUploads = await parseUploadedTracks(uploadedFiles);
      if (parsedUploads.length === 0) return;

      setFiles((prevFiles) => [
        ...prevFiles,
        ...parsedUploads.map((upload) => upload.file),
      ]);

      const forceSingleAlbum = parsedUploads.length > 1;
      let firstSelectedAlbumId: string | null = null;

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
    setFiles((prevFiles) => prevFiles.filter((file) => file.id !== idToRemove));
    setAlbums((prevAlbums) => removeTrackFromAlbums(prevAlbums, idToRemove));
    setLooseTrackIds((prevLooseTrackIds) =>
      prevLooseTrackIds.filter((trackId) => trackId !== idToRemove)
    );
  };

  const handleRemoveAlbum = (albumId: string) => {
    const albumToRemove = albums.find((album) => album.id === albumId);
    if (!albumToRemove) return;

    const trackIdSet = new Set(albumToRemove.trackIds);
    setFiles((prevFiles) => prevFiles.filter((file) => !trackIdSet.has(file.id)));
    setAlbums((prevAlbums) => prevAlbums.filter((album) => album.id !== albumId));
    setLooseTrackIds((prevLooseTrackIds) =>
      prevLooseTrackIds.filter((trackId) => !trackIdSet.has(trackId))
    );

    if (editingAlbumId === albumId) {
      closeAlbumDialog();
    }
  };

  const handleSelectAlbum = (albumId: string) => {
    setSelectedAlbumId(albumId);
    const album = albums.find((entry) => entry.id === albumId);
    setSelectedFileId(album?.trackIds[0] ?? null);
  };

  const handleSelectFile = (albumId: string, fileId: string) => {
    setSelectedAlbumId(albumId);
    setSelectedFileId(fileId);
  };

  const handleSelectLooseTrack = (fileId: string) => {
    setSelectedAlbumId(null);
    setSelectedFileId(fileId);
  };

  const openCreateAlbumDialog = (seedTrackIds: string[]) => {
    const uniqueSeedTrackIds = asUniqueTrackIds(seedTrackIds);
    if (uniqueSeedTrackIds.length === 0) {
      console.warn("Create album requested with no available tracks.");
      return;
    }

    const seedTrack = files.find((file) => file.id === uniqueSeedTrackIds[0]);
    const albumCount = albums.filter((album) => /^Album\s\d+$/i.test(album.title)).length;

    setAlbumDialogMode("create");
    setEditingAlbumId(null);
    setCreateSeedTrackIds(uniqueSeedTrackIds);
    setAlbumDraft({
      title: seedTrack?.metadata?.album?.trim() || `Album ${albumCount + 1}`,
      artist: seedTrack?.metadata?.artist || "",
      genre: toGenreString(seedTrack?.metadata?.genre),
      cover:
        seedTrack?.metadata?.picture && seedTrack.metadata.picture.length > 0
          ? seedTrack.metadata.picture
          : undefined,
      syncTrackNumbers: false,
    });
    setAlbumDialogOpen(true);
  };

  const handleOpenCreateAlbumDialog = () => {
    const seedTrackId = selectedFileId ?? files[0]?.id ?? null;
    if (!seedTrackId) {
      console.warn("Create album requested with no available tracks.");
      return;
    }

    openCreateAlbumDialog([seedTrackId]);
  };

  const handlePromptCreateAlbumFromLooseTracks = (
    sourceTrackId: string,
    targetTrackId: string
  ) => {
    if (sourceTrackId === targetTrackId) return;

    const shouldCreate = window.confirm(
      "Create a new album containing these tracks?"
    );
    if (!shouldCreate) return;

    const idSet = new Set([sourceTrackId, targetTrackId]);
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

    if (albumDialogMode === "create" && createSeedTrackIds.length > 0) {
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

  const handleMoveTrackToAlbum = (
    trackId: string,
    targetAlbumId: string,
    targetIndex: number
  ) => {
    const moved = moveTrackInSidebar(albums, looseTrackIds, trackId, {
      type: "album",
      albumId: targetAlbumId,
      index: targetIndex,
    });

    setAlbums(moved.albums);
    setLooseTrackIds(moved.looseTrackIds);
    setSelectedAlbumId(targetAlbumId);
    setSelectedFileId(trackId);

    if (moved.albumsToSync.length > 0) {
      setFiles((prevFiles) =>
        applyTrackOrderNumbersToFiles(prevFiles, moved.albums, moved.albumsToSync)
      );
    }
  };

  const handleMoveTrackToLoose = (trackId: string, targetIndex: number) => {
    const moved = moveTrackInSidebar(albums, looseTrackIds, trackId, {
      type: "loose",
      index: targetIndex,
    });

    setAlbums(moved.albums);
    setLooseTrackIds(moved.looseTrackIds);
    setSelectedAlbumId(null);
    setSelectedFileId(trackId);

    if (moved.albumsToSync.length > 0) {
      setFiles((prevFiles) =>
        applyTrackOrderNumbersToFiles(prevFiles, moved.albums, moved.albumsToSync)
      );
    }
  };

  return (
    <>
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
          onAudioUpload={handleAudioUpload}
          onSelectAlbum={handleSelectAlbum}
          onSelectFile={handleSelectFile}
          onSelectLooseTrack={handleSelectLooseTrack}
          onRemoveFile={handleRemoveFile}
          onRemoveAlbum={handleRemoveAlbum}
          onAddAlbum={handleOpenCreateAlbumDialog}
          onEditAlbum={handleOpenEditAlbumDialog}
          onMoveTrackToAlbum={handleMoveTrackToAlbum}
          onMoveTrackToLoose={handleMoveTrackToLoose}
          onPromptCreateAlbumFromLooseTracks={
            handlePromptCreateAlbumFromLooseTracks
          }
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
