"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileMusic, Check, AlertCircle, X } from "lucide-react";

export interface FileStatus {
  id: string;
  file: File;
  status: "pending" | "saved" | "error";
  filename: string;
}

interface FileListProps {
  files: FileStatus[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onRemoveFile: (id: string) => void;
}

export default function FileList({
  files,
  selectedFileId,
  onSelectFile,
  onRemoveFile,
}: FileListProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      <div className="pb-2 pl-6 border-b font-semibold text-sm text-muted-foreground">
        files ({files.length})
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col p-2 gap-1">
          {files.map((file) => (
            <div key={file.id} className="relative group">
              <Button
                variant="ghost"
                className={cn(
                  "justify-start h-auto py-2 px-3 w-full text-left font-normal pr-8",
                  selectedFileId === file.id
                    ? "bg-accent text-accent-foreground"
                    : ""
                )}
                onClick={() => onSelectFile(file.id)}
              >
                <div className="flex items-center gap-2 w-full overflow-hidden">
                  <FileMusic className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm flex-1">{file.filename}</span>
                  {file.status === "saved" && (
                    <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                  )}
                  {file.status === "error" && (
                    <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                  )}
                </div>
              </Button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFile(file.id);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded-full cursor-pointer"
                title="Remove file"
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
